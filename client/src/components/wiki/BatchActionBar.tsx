import { Button, Space, Modal, message, Select } from 'antd'
import { useState } from 'react'
import { InboxOutlined, DeleteOutlined, RollbackOutlined, TagsOutlined, CloseOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { wikiApi } from '../../services/wikiService'

interface Props {
  selectedIds: number[]
  spaceId: number
  onClear: () => void
}

export default function BatchActionBar({ selectedIds, spaceId, onClear }: Props) {
  const qc = useQueryClient()
  const [tagModal, setTagModal] = useState(false)
  const [tagsToAdd, setTagsToAdd] = useState<string[]>([])

  const run = useMutation({
    mutationFn: ({ action, payload }: { action: string; payload?: any }) =>
      wikiApi.batchPages(action, selectedIds, payload),
    onSuccess: (r: any) => {
      const ok = (r.data || []).filter((x: any) => x.ok).length
      const fail = (r.data || []).length - ok
      message.success(`完成：成功 ${ok} 条${fail ? `，失败 ${fail}` : ''}`)
      qc.invalidateQueries({ queryKey: ['wiki', 'tree', spaceId] })
      qc.invalidateQueries({ queryKey: ['wiki', 'trash'] })
      onClear()
    },
    onError: (e: any) => message.error(e?.message || '批量操作失败')
  })

  if (selectedIds.length === 0) return null

  return (
    <>
      <div style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#fff',
        border: '1px solid #d9d9d9',
        borderRadius: 8,
        padding: '8px 16px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        zIndex: 1000
      }}>
        <Space>
          <span>已选 <strong>{selectedIds.length}</strong> 项</span>
          <Button size="small" icon={<TagsOutlined />} onClick={() => setTagModal(true)}>
            打标签
          </Button>
          <Button size="small" icon={<InboxOutlined />} onClick={() => run.mutate({ action: 'archive' })}>
            归档
          </Button>
          <Button size="small" icon={<RollbackOutlined />} onClick={() => run.mutate({ action: 'unarchive' })}>
            取消归档
          </Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => Modal.confirm({
            title: `删除 ${selectedIds.length} 个页面？`,
            content: '将进入回收站，30 天内可恢复',
            onOk: () => run.mutate({ action: 'delete' })
          })}>
            删除
          </Button>
          <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClear}>取消</Button>
        </Space>
      </div>

      <Modal
        title="批量打标签"
        open={tagModal}
        onCancel={() => setTagModal(false)}
        onOk={() => {
          if (tagsToAdd.length === 0) { message.warning('请输入标签'); return }
          run.mutate({ action: 'tag', payload: { tags: tagsToAdd } })
          setTagModal(false)
          setTagsToAdd([])
        }}
      >
        <Select
          mode="tags"
          style={{ width: '100%' }}
          placeholder="输入标签后回车"
          value={tagsToAdd}
          onChange={setTagsToAdd}
          tokenSeparators={[',', ' ']}
        />
      </Modal>
    </>
  )
}
