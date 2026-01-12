import { useState } from 'react'
import { Table, Button, Space, message, Popconfirm, Tag } from 'antd'
import { DeleteOutlined, RollbackOutlined, ClearOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
// import { useAuthStore } from '../stores/authStore' // 暂时未使用
import api from '../services/api'

export default function Trash() {
  const [currentPage, setCurrentPage] = useState(1)
  const queryClient = useQueryClient()
  // const { user } = useAuthStore() // 暂时未使用

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['trash', currentPage],
    queryFn: () => api.get('/files/trash/list', {
      params: { page: currentPage, pageSize: 20 }
    })
  })

  // 调试信息
  if (error) {
    console.error('回收站数据获取错误:', error)
  }
  if (data) {
    console.log('回收站响应数据:', data)
    console.log('回收站文件列表:', data?.data?.files)
    console.log('回收站总数:', data?.data?.total)
  }

  // API 拦截器已经返回了 response.data，所以这里只需要 data.data
  const files = data?.data?.files || []
  const total = data?.data?.total || 0

  // 恢复文件
  const handleRestore = async (fileId: number) => {
    try {
      await api.post(`/files/${fileId}/restore`)
      message.success('文件已恢复')
      refetch()
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (error: any) {
      message.error(error.response?.data?.message || '恢复失败')
    }
  }

  // 永久删除文件
  const handlePermanentDelete = async (fileId: number) => {
    try {
      await api.delete(`/files/${fileId}/permanent`)
      message.success('文件已永久删除')
      refetch()
    } catch (error: any) {
      message.error(error.response?.data?.message || '删除失败')
    }
  }

  // 批量恢复
  const handleBatchRestore = async (fileIds: number[]) => {
    try {
      await Promise.all(fileIds.map(id => api.post(`/files/${id}/restore`)))
      message.success(`已恢复 ${fileIds.length} 个文件`)
      refetch()
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (error: any) {
      message.error('批量恢复失败')
    }
  }

  // 批量永久删除
  const handleBatchPermanentDelete = async (fileIds: number[]) => {
    try {
      await Promise.all(fileIds.map(id => api.delete(`/files/${id}/permanent`)))
      message.success(`已永久删除 ${fileIds.length} 个文件`)
      refetch()
    } catch (error: any) {
      message.error('批量删除失败')
    }
  }

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  const columns = [
    {
      title: '文件名',
      dataIndex: 'original_name',
      key: 'original_name'
    },
    {
      title: '所属空间',
      dataIndex: 'space_name',
      key: 'space_name',
      render: (name: string) => name || <span style={{ color: '#999' }}>未分类</span>
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      key: 'file_size',
      render: (size: number) => {
        if (size < 1024) return `${size} B`
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`
        if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`
        return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
      }
    },
    {
      title: '上传人',
      dataIndex: 'creator_name',
      key: 'creator_name'
    },
    {
      title: '删除时间',
      dataIndex: 'deleted_at',
      key: 'deleted_at',
      render: (time: string) => new Date(time).toLocaleString()
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <Popconfirm
            title="确定要恢复此文件吗？"
            onConfirm={() => handleRestore(record.id)}
          >
            <Button 
              type="link" 
              size="small"
              icon={<RollbackOutlined />}
            >
              恢复
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确定要永久删除此文件吗？此操作不可恢复！"
            onConfirm={() => handlePermanentDelete(record.id)}
            okType="danger"
          >
            <Button 
              type="link" 
              size="small" 
              danger
              icon={<DeleteOutlined />}
            >
              永久删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  const rowSelection = {
    selectedRowKeys,
    onChange: (selectedKeys: React.Key[]) => {
      setSelectedRowKeys(selectedKeys)
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>回收站</h2>
        <Space>
          {selectedRowKeys.length > 0 && (
            <>
              <Popconfirm
                title={`确定要恢复选中的 ${selectedRowKeys.length} 个文件吗？`}
                onConfirm={() => {
                  handleBatchRestore(selectedRowKeys as number[])
                  setSelectedRowKeys([])
                }}
              >
                <Button icon={<RollbackOutlined />}>
                  批量恢复
                </Button>
              </Popconfirm>
              <Popconfirm
                title={`确定要永久删除选中的 ${selectedRowKeys.length} 个文件吗？此操作不可恢复！`}
                onConfirm={() => {
                  handleBatchPermanentDelete(selectedRowKeys as number[])
                  setSelectedRowKeys([])
                }}
                okType="danger"
              >
                <Button danger icon={<ClearOutlined />}>
                  批量永久删除
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      </div>

      <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#fffbe6', borderRadius: 4 }}>
        <Tag color="warning">提示</Tag>
        回收站中的文件将在 30 天后自动清理。管理员可以在系统设置中手动清理过期文件。
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#fff2f0', borderRadius: 4, color: '#ff4d4f' }}>
          加载回收站数据失败: {error instanceof Error ? error.message : '未知错误'}
        </div>
      )}

      <Table
        rowSelection={rowSelection}
        columns={columns}
        dataSource={files}
        loading={isLoading}
        rowKey="id"
        pagination={{
          current: currentPage,
          pageSize: 20,
          total: total,
          onChange: (page) => setCurrentPage(page),
          showTotal: (total) => `共 ${total} 条记录`
        }}
        locale={{
          emptyText: isLoading ? '加载中...' : '回收站为空'
        }}
      />
    </div>
  )
}

