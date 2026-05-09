import { useMemo } from 'react'
import { Tree, Empty, Spin } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { FileTextOutlined, EditOutlined } from '@ant-design/icons'
import type { WikiPage } from '../../services/wikiService'

export interface PageTreeProps {
  pages: WikiPage[]
  selectedKey?: number
  loading?: boolean
  onSelect?: (page: WikiPage) => void
  onDrop?: (info: { dragId: number; dropId: number | null; dropToGap: boolean }) => void
  /** 多选模式 */
  checkable?: boolean
  checkedKeys?: number[]
  onCheckChange?: (keys: number[]) => void
}

export default function PageTree({
  pages, selectedKey, loading, onSelect, onDrop,
  checkable, checkedKeys, onCheckChange
}: PageTreeProps) {
  const treeData = useMemo<DataNode[]>(() => {
    const byId = new Map<number, any>()
    pages.forEach(p => byId.set(p.id, { ...p, children: [] }))
    const roots: any[] = []
    pages.forEach(p => {
      const node = byId.get(p.id)
      if (p.parent_id && byId.has(p.parent_id)) {
        byId.get(p.parent_id).children.push(node)
      } else {
        roots.push(node)
      }
    })
    const toDataNode = (n: any): DataNode => ({
      key: n.id,
      title: (
        <span>
          {n.status === 'draft' && <EditOutlined style={{ color: '#faad14', marginRight: 4 }} title="草稿" />}
          <FileTextOutlined style={{ marginRight: 4, color: '#0d9488' }} />
          {n.title}
          {n.archived_at && <span style={{ marginLeft: 6, color: '#999', fontSize: 11 }}>(已归档)</span>}
        </span>
      ),
      children: n.children.map(toDataNode),
      isLeaf: n.children.length === 0
    })
    return roots.map(toDataNode)
  }, [pages])

  if (loading) return <Spin />
  if (pages.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无页面" />
  }

  return (
    <Tree
      blockNode
      showLine
      defaultExpandAll
      draggable={!!onDrop && !checkable}
      treeData={treeData}
      checkable={!!checkable}
      checkedKeys={checkable ? (checkedKeys || []) : undefined}
      onCheck={(keys: any) => {
        const arr = Array.isArray(keys) ? keys : keys.checked
        onCheckChange?.((arr || []).map((k: any) => Number(k)))
      }}
      selectedKeys={selectedKey ? [selectedKey] : []}
      onSelect={(keys) => {
        if (!keys.length) return
        const id = Number(keys[0])
        const p = pages.find(x => x.id === id)
        if (p && onSelect) onSelect(p)
      }}
      onDrop={onDrop && !checkable ? (info) => {
        const dragId = Number(info.dragNode.key)
        const dropId = info.dropToGap ? null : Number(info.node.key)
        onDrop({ dragId, dropId, dropToGap: info.dropToGap })
      } : undefined}
    />
  )
}
