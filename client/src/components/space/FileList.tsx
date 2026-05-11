import { Table, Breadcrumb, Tag, Button, Space, Empty, Typography } from 'antd'
import { CloseOutlined, SearchOutlined } from '@ant-design/icons'
import FileActions from '../FileActions'
import { formatDateTime } from '../../utils/date'
import { FILE_DRAG_MIME } from './FolderTree'

const { Text } = Typography

export type FileListMode = 'folder' | 'all' | 'search'

export interface FileListProps {
  mode: FileListMode
  files: any[]
  total: number
  loading?: boolean
  page: number
  pageSize: number
  onPageChange: (page: number, pageSize: number) => void
  selectedRowKeys: React.Key[]
  onSelectChange: (keys: React.Key[]) => void

  // 面包屑（folder 模式下用）
  breadcrumb?: { key: string; title: React.ReactNode; onClick?: () => void }[]
  // 搜索徽章（search 模式下用）
  searchKeyword?: string
  onClearSearch?: () => void

  // 行操作 — 全部透传到 FileActions
  onPreview: (file: any) => void
  onDownload: (fileId: number, fileName: string) => void
  onRename: (file: any) => void
  onMove: (file: any) => void
  onRemoveFromSpace: (fileId: number) => void
  onDelete: (fileId: number) => void

  // 空态附加内容（如上传按钮）
  emptyExtra?: React.ReactNode
}

function formatSize(size?: number) {
  if (!size) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * 空间右侧文件列表：面包屑 + 搜索徽章 + 表格。
 * 表格行支持拖出（dataTransfer 写入 FILE_DRAG_MIME），由父级 FolderTree 监听 drop。
 */
export default function FileList(props: FileListProps) {
  const {
    mode, files, total, loading, page, pageSize, onPageChange,
    selectedRowKeys, onSelectChange,
    breadcrumb, searchKeyword, onClearSearch,
    onPreview, onDownload, onRename, onMove, onRemoveFromSpace, onDelete,
    emptyExtra
  } = props

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶部状态行：搜索徽章 优先；其次面包屑 */}
      {mode === 'search' && searchKeyword ? (
        <div style={{ marginBottom: 12 }}>
          <Space>
            <Tag icon={<SearchOutlined />} color="cyan" style={{ padding: '2px 8px' }}>
              搜索：<strong>{searchKeyword}</strong> · 共 {total} 项
            </Tag>
            {onClearSearch && (
              <Button size="small" icon={<CloseOutlined />} onClick={onClearSearch}>清除搜索</Button>
            )}
          </Space>
        </div>
      ) : breadcrumb && breadcrumb.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <Breadcrumb
            items={breadcrumb.map(b => ({
              key: b.key,
              title: b.onClick
                ? <a onClick={b.onClick}>{b.title}</a>
                : <Text>{b.title}</Text>
            }))}
          />
        </div>
      ) : null}

      <div className="scroll-table-wrap" style={{ flex: 1 }}>
        <Table
          rowSelection={{
            selectedRowKeys,
            onChange: onSelectChange
          }}
          dataSource={files}
          rowKey="id"
          loading={loading}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  mode === 'search' ? '未找到匹配的文件'
                  : mode === 'folder' ? '此文件夹暂无文件'
                  : '此空间暂无文件'
                }
              >
                {emptyExtra}
              </Empty>
            )
          }}
          onRow={(record) => ({
            draggable: true,
            onDragStart: (e) => {
              e.dataTransfer.setData(FILE_DRAG_MIME, String(record.id))
              e.dataTransfer.effectAllowed = 'move'
            }
          })}
          columns={[
            {
              title: '文件名',
              dataIndex: 'original_name',
              key: 'original_name',
              ellipsis: true,
              render: (text: string, record: any) => (
                <a onClick={(e) => { e.preventDefault(); onPreview(record) }}>
                  {text}
                </a>
              )
            },
            ...(mode !== 'folder' ? [{
              title: '所在文件夹',
              dataIndex: 'folder_name',
              key: 'folder_name',
              ellipsis: true,
              render: (_: any, record: any) =>
                record.folder_id
                  ? (record.folder_name || <Text type="secondary">已删除</Text>)
                  : <Text type="secondary">根目录</Text>
            }] : []),
            {
              title: '大小',
              dataIndex: 'file_size',
              key: 'file_size',
              width: 110,
              render: (size: number) => formatSize(size)
            },
            {
              title: '上传人',
              dataIndex: 'creator_name',
              key: 'creator_name',
              width: 120
            },
            {
              title: '上传时间',
              dataIndex: 'created_at',
              key: 'created_at',
              width: 160,
              render: (t: string) => formatDateTime(t)
            },
            {
              title: '操作',
              key: 'action',
              width: 220,
              render: (_: any, record: any) => (
                <FileActions
                  record={record}
                  onPreview={onPreview}
                  onDownload={onDownload}
                  onRename={onRename}
                  onMove={onMove}
                  onRemoveFromSpace={onRemoveFromSpace}
                  onDelete={onDelete}
                />
              )
            }
          ]}
          pagination={mode === 'search' ? false : {
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 50, 100],
            showTotal: (t) => `共 ${t} 条`,
            onChange: onPageChange
          }}
        />
      </div>
    </div>
  )
}
