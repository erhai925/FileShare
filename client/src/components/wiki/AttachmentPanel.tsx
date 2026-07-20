import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { App, List, Button, Upload, Space, message, Empty, Modal, Typography } from 'antd'
import {
  PaperClipOutlined, UploadOutlined, DeleteOutlined, DownloadOutlined
} from '@ant-design/icons'
import api from '../../services/api'
import { wikiApi } from '../../services/wikiService'
import ChunkUpload from '../ChunkUpload'
import { askUploadMode } from '../../utils/uploadGuard'

const { Text } = Typography

function fmtSize(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export default function AttachmentPanel({
  pageId, canWrite
}: { pageId: number; canWrite?: boolean }) {
  const qc = useQueryClient()
  const { message: messageApi, modal: modalApi } = App.useApp()
  const [uploading, setUploading] = useState(false)
  const [chunkVisible, setChunkVisible] = useState(false)
  const [chunkFile, setChunkFile] = useState<File | null>(null)

  const { data } = useQuery({
    queryKey: ['wiki', 'attachments', pageId],
    queryFn: () => wikiApi.listAttachments(pageId)
  })

  const detach = useMutation({
    mutationFn: (fileId: number) => wikiApi.detachFile(pageId, fileId),
    onSuccess: () => {
      message.success('附件已移除')
      qc.invalidateQueries({ queryKey: ['wiki', 'attachments', pageId] })
    },
    onError: (e: any) => message.error(e?.message || '移除失败')
  })

  /** 大文件走分块上传：拿到 fileId 后同样挂到本页面 */
  const attachExisting = async (fileId: number) => {
    try {
      await wikiApi.attachFile(pageId, fileId)
      messageApi.success('附件已添加')
      qc.invalidateQueries({ queryKey: ['wiki', 'attachments', pageId] })
    } catch (e: any) {
      messageApi.error(e?.message || '附件关联失败')
    } finally {
      setChunkVisible(false)
      setChunkFile(null)
    }
  }

  /** 上传入口：先判定大小，超阈值转分块上传，其余走普通上传 */
  const beforeUpload = async (file: File) => {
    const mode = await askUploadMode(file, modalApi)
    if (mode === 'chunk') {
      setChunkFile(file)
      setChunkVisible(true)
      return Upload.LIST_IGNORE
    }
    return handleUpload(file)
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      // 复用现有文件上传接口
      const r: any = await api.post('/files/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      const fileId = r?.data?.fileId || r?.data?.id || r?.fileId
      if (!fileId) throw new Error('上传未返回 fileId')
      await wikiApi.attachFile(pageId, fileId)
      message.success('附件已添加')
      qc.invalidateQueries({ queryKey: ['wiki', 'attachments', pageId] })
    } catch (e: any) {
      message.error(e?.message || '上传失败')
    } finally {
      setUploading(false)
    }
    return false // 阻止 antd 默认上传
  }

  const items = data?.data || []

  return (
    <div>
      <Space style={{ marginBottom: 8, width: '100%', justifyContent: 'space-between' }}>
        <Text strong><PaperClipOutlined /> 附件 ({items.length})</Text>
        {canWrite && (
          <Upload beforeUpload={beforeUpload} showUploadList={false}>
            <Button size="small" icon={<UploadOutlined />} loading={uploading}>
              添加附件
            </Button>
          </Upload>
        )}
      </Space>
      {items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无附件" />
      ) : (
        <List
          size="small"
          dataSource={items}
          renderItem={(a: any) => (
            <List.Item style={{ paddingLeft: 0, paddingRight: 0 }}>
              <div style={{ width: '100%', minWidth: 0 }}>
                {/* 文件名单行，过长省略，hover 显示全名 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  <PaperClipOutlined style={{ color: '#0d9488', flexShrink: 0 }} />
                  <Text ellipsis={{ tooltip: a.original_name }} style={{ flex: 1, minWidth: 0 }}>
                    {a.original_name}
                  </Text>
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {fmtSize(a.file_size)}{a.uploader_name ? ` · ${a.uploader_name}` : ''}
                </Text>
                {/* 操作按钮另起一行，避免在窄栏挤压文件名 */}
                <div style={{ marginTop: 2 }}>
                  <Space size={4}>
                    <Button
                      size="small"
                      type="link"
                      icon={<DownloadOutlined />}
                      href={`/api/files/${a.file_id}/download`}
                      target="_blank"
                      style={{ padding: '0 4px', height: 22 }}
                    >下载</Button>
                    {canWrite && (
                      <Button
                        size="small"
                        type="link"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => Modal.confirm({
                          title: '移除附件？',
                          content: '仅断开附件挂载，文件库中的源文件保留',
                          onOk: () => detach.mutate(a.file_id)
                        })}
                        style={{ padding: '0 4px', height: 22 }}
                      >移除</Button>
                    )}
                  </Space>
                </div>
              </div>
            </List.Item>
          )}
        />
      )}
      <Modal
        title="大文件上传（支持断点续传）"
        open={chunkVisible}
        onCancel={() => { setChunkVisible(false); setChunkFile(null) }}
        footer={null}
        destroyOnClose
      >
        <ChunkUpload
          messageApi={messageApi}
          initialFile={chunkFile}
          onInitialFileConsumed={() => setChunkFile(null)}
          onSuccess={(fileId) => attachExisting(fileId)}
        />
      </Modal>
    </div>
  )
}
