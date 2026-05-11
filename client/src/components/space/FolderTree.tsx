import { useMemo, useState } from 'react'
import { Tree, Empty, Dropdown, Button } from 'antd'
import type { DataNode } from 'antd/es/tree'
import {
  FolderOutlined, FolderOpenOutlined, AppstoreOutlined,
  MoreOutlined, PlusOutlined, EditOutlined, DeleteOutlined
} from '@ant-design/icons'

export interface FolderNode {
  id: number
  name: string
  parent_id: number | null
  path: string
  file_count?: number
  children?: FolderNode[]
}

// 表格行拖到树节点时，DataTransfer 用这个 key 标识
export const FILE_DRAG_MIME = 'application/x-fileshare-file'

export type SelectedKey = number | 'all'

export interface FolderTreeProps {
  folders: FolderNode[]
  selectedKey: SelectedKey
  onSelect: (key: SelectedKey) => void
  /** 文件夹间拖拽（成为目标的子节点） */
  onFolderDrop?: (dragId: number, dropId: number | null) => void
  /** 文件行拖到文件夹（文件 id 从 dataTransfer 读出） */
  onFileDrop?: (fileId: number, targetFolderId: number) => void
  /** 节点操作：新建子文件夹 / 重命名 / 删除 */
  onContextAction?: (action: 'create' | 'rename' | 'delete', folderId: number) => void
  canWrite?: boolean
}

/**
 * 空间文件夹左树：
 * - 顶部「全部文件」虚拟根（key='all'），不可拖、不可被拖入
 * - 真实文件夹节点支持单选 + 树内拖拽（folder → folder）
 * - 节点同时监听外部 HTML5 拖拽（来自右侧文件表行），按 FILE_DRAG_MIME 区分
 */
export default function FolderTree({
  folders, selectedKey, onSelect, onFolderDrop, onFileDrop, onContextAction, canWrite
}: FolderTreeProps) {
  const [dragOverId, setDragOverId] = useState<number | null>(null)

  // 扁平化方便后续校验
  const allFolders = useMemo(() => {
    const out: FolderNode[] = []
    const walk = (arr: FolderNode[]) => arr.forEach(n => {
      out.push(n)
      if (n.children?.length) walk(n.children)
    })
    walk(folders)
    return out
  }, [folders])

  // 拖某文件夹时禁止拖到自身及后代上
  const getDescendantIds = (id: number): Set<number> => {
    const ids = new Set<number>([id])
    const walk = (arr: FolderNode[]) => arr.forEach(n => {
      if (ids.has(n.parent_id || -1)) {
        ids.add(n.id)
        if (n.children?.length) walk(n.children)
      }
    })
    // 反复扫直到稳定（避免依赖顺序）
    let prevSize = 0
    while (ids.size !== prevSize) {
      prevSize = ids.size
      walk(allFolders)
    }
    return ids
  }

  const renderTitle = (folder: FolderNode, isAll = false) => {
    if (isAll) {
      return (
        <span style={{ fontWeight: 500 }}>
          <AppstoreOutlined style={{ marginRight: 6, color: '#0d9488' }} />
          全部文件
        </span>
      )
    }
    const isDropTarget = dragOverId === folder.id
    const titleEl = (
      <span
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(FILE_DRAG_MIME)) {
            e.preventDefault()
            e.stopPropagation()
            setDragOverId(folder.id)
          }
        }}
        onDragLeave={() => setDragOverId(prev => prev === folder.id ? null : prev)}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData(FILE_DRAG_MIME)
          if (raw) {
            e.preventDefault()
            e.stopPropagation()
            setDragOverId(null)
            const fid = parseInt(raw)
            if (!isNaN(fid)) onFileDrop?.(fid, folder.id)
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '0 4px',
          borderRadius: 4,
          background: isDropTarget ? 'rgba(13, 148, 136, 0.12)' : undefined,
          border: isDropTarget ? '1px dashed #0d9488' : '1px dashed transparent'
        }}
      >
        <FolderOutlined style={{ color: '#faad14' }} />
        <span>{folder.name}</span>
        {typeof folder.file_count === 'number' && folder.file_count > 0 && (
          <span style={{ color: '#999', fontSize: 11 }}>· {folder.file_count}</span>
        )}
      </span>
    )
    if (!canWrite || !onContextAction) return titleEl
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%' }}>
        {titleEl}
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'create', icon: <PlusOutlined />, label: '新建子文件夹' },
              { key: 'rename', icon: <EditOutlined />, label: '重命名' },
              { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true }
            ],
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation()
              onContextAction(key as any, folder.id)
            }
          }}
        >
          <Button
            type="text"
            size="small"
            icon={<MoreOutlined />}
            onClick={(e) => e.stopPropagation()}
            style={{ marginLeft: 'auto', opacity: 0.55 }}
          />
        </Dropdown>
      </span>
    )
  }

  const toDataNode = (folder: FolderNode): DataNode => ({
    key: folder.id,
    title: renderTitle(folder),
    icon: ({ expanded }) => expanded
      ? <FolderOpenOutlined style={{ color: '#faad14' }} />
      : <FolderOutlined style={{ color: '#faad14' }} />,
    children: (folder.children || []).map(toDataNode)
  })

  // 顶部虚拟根节点
  const allNode: DataNode = {
    key: 'all',
    title: renderTitle({} as any, true),
    selectable: true,
    disabled: false
  }

  const treeData: DataNode[] = [
    allNode,
    ...folders.map(toDataNode)
  ]

  return (
    <div
      style={{ padding: 8 }}
      onDragLeave={() => setDragOverId(null)}
    >
      {folders.length === 0 ? (
        <>
          <Tree
            blockNode
            selectedKeys={[selectedKey]}
            treeData={[allNode]}
            onSelect={(keys) => keys.length && onSelect(keys[0] as SelectedKey)}
          />
          <div style={{ padding: 16 }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有文件夹" />
          </div>
        </>
      ) : (
        <Tree
          blockNode
          showLine
          defaultExpandAll
          draggable={!!onFolderDrop && !!canWrite ? {
            icon: false,
            // 「全部文件」虚拟根禁止拖动
            nodeDraggable: (node) => node.key !== 'all'
          } : false}
          allowDrop={(info) => {
            // 不允许拖到「全部文件」节点
            if (info.dropNode.key === 'all') return false
            const dragId = Number(info.dragNode.key)
            const dropId = Number(info.dropNode.key)
            if (isNaN(dragId) || isNaN(dropId)) return false
            // 禁止拖到自身或后代下
            const desc = getDescendantIds(dragId)
            if (desc.has(dropId)) return false
            return true
          }}
          treeData={treeData}
          selectedKeys={[selectedKey]}
          onSelect={(keys) => keys.length && onSelect(keys[0] as SelectedKey)}
          onDrop={(info) => {
            if (info.dragNode.key === 'all' || info.node.key === 'all') return
            const dragId = Number(info.dragNode.key)
            const dropId = info.dropToGap ? null : Number(info.node.key)
            if (isNaN(dragId)) return
            onFolderDrop?.(dragId, isNaN(dropId as number) ? null : dropId)
          }}
        />
      )}
    </div>
  )
}
