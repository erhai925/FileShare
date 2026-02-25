import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Card, Button, Space, Modal, Form, Input, Select, message, Table, Tag, Popconfirm, Upload, Tabs, Tree, Empty, Breadcrumb, Typography } from 'antd'
import { FolderOutlined, PlusOutlined, UserOutlined, SettingOutlined, UploadOutlined, EditOutlined, DeleteOutlined, ArrowLeftOutlined, FileOutlined, FolderOpenOutlined, SearchOutlined } from '@ant-design/icons'
import FileActions from '../components/FileActions'
import FilePreview from '../components/FilePreview'
import { formatDateTime } from '../utils/date'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'
import api from '../services/api'
import type { UploadProps } from 'antd'
import type { DataNode } from 'antd/es/tree'

const { Option } = Select
const { Title } = Typography

export default function SpaceDetail() {
  const { spaceId } = useParams<{ spaceId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [folderModalVisible, setFolderModalVisible] = useState(false)
  const [renameFolderModalVisible, setRenameFolderModalVisible] = useState(false)
  const [membersModalVisible, setMembersModalVisible] = useState(false)
  const [settingsModalVisible, setSettingsModalVisible] = useState(false)
  const [moveFileModalVisible, setMoveFileModalVisible] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<any>(null)
  const [selectedFile, setSelectedFile] = useState<any>(null)
  const [folderForm] = Form.useForm()
  const [renameFolderForm] = Form.useForm()
  const [memberForm] = Form.useForm()
  const [settingsForm] = Form.useForm()
  const [moveFileForm] = Form.useForm()
  const queryClient = useQueryClient()
  const { token, user } = useAuthStore()
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewFileId, setPreviewFileId] = useState<number | null>(null)
  const [renameFileModalVisible, setRenameFileModalVisible] = useState(false)
  const [renameFileForm] = Form.useForm()
  const [spaceSearchKeyword, setSpaceSearchKeyword] = useState('')
  const [debouncedSpaceSearch, setDebouncedSpaceSearch] = useState('')
  const [searchSelectedRowKeys, setSearchSelectedRowKeys] = useState<React.Key[]>([])
  const [fileListSelectedRowKeys, setFileListSelectedRowKeys] = useState<React.Key[]>([])
  const [folderFilesSelectedRowKeys, setFolderFilesSelectedRowKeys] = useState<React.Key[]>([])
  const [batchFileIds, setBatchFileIds] = useState<number[]>([])
  const [moveSubmitting, setMoveSubmitting] = useState(false)

  const spaceIdNum = spaceId ? parseInt(spaceId) : null

  // 当前用于批量操作的选中项（优先搜索 > 文件列表 > 文件夹内文件）
  const batchIds = searchSelectedRowKeys.length
    ? searchSelectedRowKeys
    : fileListSelectedRowKeys.length
      ? fileListSelectedRowKeys
      : folderFilesSelectedRowKeys
  const batchCount = Array.isArray(batchIds) ? batchIds.length : 0
  const batchSource = searchSelectedRowKeys.length
    ? 'search'
    : fileListSelectedRowKeys.length
      ? 'fileList'
      : folderFilesSelectedRowKeys.length
        ? 'folderFiles'
        : null

  const clearBatchSelection = () => {
    setSearchSelectedRowKeys([])
    setFileListSelectedRowKeys([])
    setFolderFilesSelectedRowKeys([])
  }
  const clearCurrentBatchSelection = () => {
    if (batchSource === 'search') setSearchSelectedRowKeys([])
    else if (batchSource === 'fileList') setFileListSelectedRowKeys([])
    else if (batchSource === 'folderFiles') setFolderFilesSelectedRowKeys([])
  }

  // 从 URL 读取 folderId，支持直接跳转到指定文件夹
  useEffect(() => {
    const folderIdParam = searchParams.get('folderId')
    if (folderIdParam) {
      const fid = parseInt(folderIdParam)
      if (!isNaN(fid)) setSelectedFolderId(fid)
    }
  }, [searchParams])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSpaceSearch(spaceSearchKeyword), 400)
    return () => clearTimeout(timer)
  }, [spaceSearchKeyword])

  // 获取空间详情
  const { data: spaceDetail, isLoading: spaceLoading, refetch: refetchSpaceDetail } = useQuery({
    queryKey: ['space-detail', spaceIdNum],
    queryFn: () => api.get(`/spaces/${spaceIdNum}`),
    enabled: !!spaceIdNum
  })

  // 获取空间文件夹列表
  const { data: foldersData, refetch: refetchFolders } = useQuery({
    queryKey: ['space-folders', spaceIdNum],
    queryFn: () => api.get(`/spaces/${spaceIdNum}/folders`),
    enabled: !!spaceIdNum
  })

  // 获取空间完整文件树（包含文件夹和文件）
  const { data: fileTreeData, refetch: refetchFileTree } = useQuery({
    queryKey: ['space-file-tree', spaceIdNum],
    queryFn: () => api.get(`/spaces/${spaceIdNum}/file-tree`),
    enabled: !!spaceIdNum
  })

  // 获取选中文件夹的文件列表
  const { data: folderFilesData, refetch: refetchFolderFiles } = useQuery({
    queryKey: ['folder-files', spaceIdNum, selectedFolderId],
    queryFn: () => api.get(`/spaces/${spaceIdNum}/folders/${selectedFolderId}/files`),
    enabled: !!spaceIdNum && !!selectedFolderId
  })

  // 获取用户列表（用于添加成员）
  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users'),
    enabled: false
  })

  // 空间内文件搜索
  const { data: spaceSearchData, isLoading: spaceSearchLoading } = useQuery({
    queryKey: ['space-search', spaceIdNum, debouncedSpaceSearch],
    queryFn: () => api.get('/search', {
      params: { keyword: debouncedSpaceSearch, spaceId: spaceIdNum, pageSize: 100 }
    }),
    enabled: !!spaceIdNum && !!debouncedSpaceSearch.trim()
  })

  // 获取空间成员
  const { data: membersData, refetch: refetchMembers } = useQuery({
    queryKey: ['space-members', spaceIdNum],
    queryFn: () => api.get(`/spaces/${spaceIdNum}/members`),
    enabled: !!spaceIdNum && membersModalVisible
  })

  // 创建文件夹
  const createFolderMutation = useMutation({
    mutationFn: ({ spaceId, data }: { spaceId: number, data: any }) =>
      api.post(`/spaces/${spaceId}/folders`, data),
    onSuccess: () => {
      message.success('文件夹创建成功')
      setFolderModalVisible(false)
      folderForm.resetFields()
      refetchFolders()
      refetchFileTree()
    },
    onError: (error: any) => {
      message.error(error.message || '创建文件夹失败')
    }
  })

  // 重命名文件夹
  const renameFolderMutation = useMutation({
    mutationFn: ({ spaceId, folderId, data }: { spaceId: number, folderId: number, data: any }) =>
      api.put(`/spaces/${spaceId}/folders/${folderId}`, data),
    onSuccess: () => {
      message.success('文件夹重命名成功')
      setRenameFolderModalVisible(false)
      setSelectedFolder(null)
      renameFolderForm.resetFields()
      refetchFolders()
      refetchFileTree()
    },
    onError: (error: any) => {
      message.error(error.message || '重命名文件夹失败')
    }
  })

  // 删除文件夹
  const deleteFolderMutation = useMutation({
    mutationFn: ({ spaceId, folderId }: { spaceId: number, folderId: number }) =>
      api.delete(`/spaces/${spaceId}/folders/${folderId}`),
    onSuccess: () => {
      message.success('文件夹删除成功')
      setSelectedFolderId(null)
      refetchFolders()
      refetchFileTree()
      if (selectedFolderId) {
        refetchFolderFiles()
      }
    },
    onError: (error: any) => {
      message.error(error.message || '删除文件夹失败')
    }
  })

  // 添加空间成员
  const addMembersMutation = useMutation({
    mutationFn: ({ spaceId, data }: { spaceId: number, data: any }) => 
      api.post(`/spaces/${spaceId}/members`, data),
    onSuccess: () => {
      message.success('成员添加成功')
      memberForm.resetFields()
      refetchMembers()
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
    },
    onError: (error: any) => {
      message.error(error.message || '添加成员失败')
    }
  })

  // 移除空间成员
  const removeMemberMutation = useMutation({
    mutationFn: ({ spaceId, userId }: { spaceId: number, userId: number }) =>
      api.delete(`/spaces/${spaceId}/members/${userId}`),
    onSuccess: () => {
      message.success('成员已移除')
      refetchMembers()
    },
    onError: (error: any) => {
      message.error(error.message || '移除成员失败')
    }
  })

  // 更新空间信息
  const updateSpaceMutation = useMutation({
    mutationFn: ({ spaceId, data }: { spaceId: number, data: any }) =>
      api.put(`/spaces/${spaceId}`, data),
    onSuccess: () => {
      message.success('空间信息更新成功')
      setSettingsModalVisible(false)
      settingsForm.resetFields()
      refetchSpaceDetail()
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
    },
    onError: (error: any) => {
      message.error(error.message || '更新空间信息失败')
    }
  })

  // 空间内文件上传配置
  const spaceUploadProps: UploadProps = {
    name: 'file',
    multiple: true,
    action: '/api/files/upload',
    headers: {
      Authorization: `Bearer ${token}`
    },
    data: {
      spaceId: spaceIdNum,
      folderId: selectedFolderId || undefined
    },
    onChange(info) {
      if (info.file.status === 'done') {
        const response = info.file.response
        if (response?.success) {
          message.success(response.message || `${info.file.name} 上传成功`)
          refetchSpaceDetail()
          refetchFileTree()
          if (selectedFolderId) {
            refetchFolderFiles()
          }
          queryClient.invalidateQueries({ queryKey: ['files'] })
        } else {
          message.error(response?.message || `${info.file.name} 上传失败`)
        }
      } else if (info.file.status === 'error') {
        const error = info.file.error || info.file.response
        const errorMsg = error?.message || error?.error?.message || `${info.file.name} 上传失败`
        message.error(errorMsg)
      }
    },
    beforeUpload: (file) => {
      const isLt10GB = file.size / 1024 / 1024 / 1024 < 10
      if (!isLt10GB) {
        message.error('文件大小不能超过10GB')
        return false
      }
      return true
    }
  }

  const handleCreateFolder = async (values: any) => {
    if (!spaceIdNum) return
    await createFolderMutation.mutateAsync({
      spaceId: spaceIdNum,
      data: values
    })
  }

  const handleRenameFolder = async (values: any) => {
    if (!spaceIdNum || !selectedFolder) return
    await renameFolderMutation.mutateAsync({
      spaceId: spaceIdNum,
      folderId: selectedFolder.id,
      data: values
    })
  }

  const handleDeleteFolder = async (folderId: number) => {
    if (!spaceIdNum) return
    await deleteFolderMutation.mutateAsync({
      spaceId: spaceIdNum,
      folderId
    })
  }

  const handleSelectFolder = (folderId: number | null) => {
    setSelectedFolderId(folderId)
  }

  const handleOpenRenameFolder = (folder: any) => {
    setSelectedFolder(folder)
    setRenameFolderModalVisible(true)
    renameFolderForm.setFieldsValue({ name: folder.name })
  }

  const handleAddMembers = async (values: any) => {
    if (!spaceIdNum) return
    await addMembersMutation.mutateAsync({
      spaceId: spaceIdNum,
      data: values
    })
  }

  const handleRemoveMember = async (userId: number) => {
    if (!spaceIdNum) return
    await removeMemberMutation.mutateAsync({
      spaceId: spaceIdNum,
      userId
    })
  }

  const handleUpdateSpace = async (values: any) => {
    if (!spaceIdNum) return
    await updateSpaceMutation.mutateAsync({
      spaceId: spaceIdNum,
      data: values
    })
  }

  const handleManageMembers = () => {
    setMembersModalVisible(true)
    queryClient.fetchQuery({ queryKey: ['users'] })
  }

  const handleOpenSettings = () => {
    setSettingsModalVisible(true)
    if (spaceDetail?.data) {
      settingsForm.setFieldsValue({
        name: spaceDetail.data.name,
        description: spaceDetail.data.description
      })
    }
  }

  const handleMoveFile = (file: any) => {
    setSelectedFile(file)
    setBatchFileIds([])
    moveFileForm.setFieldsValue({
      folderId: file.folder_id || null
    })
    setMoveFileModalVisible(true)
  }

  const handleBatchMoveInSpace = () => {
    if (batchCount === 0 || !spaceIdNum) return
    setSelectedFile(null)
    setBatchFileIds(batchIds as number[])
    moveFileForm.setFieldsValue({ folderId: null })
    setMoveFileModalVisible(true)
  }

  const handleMoveFileConfirm = async (values: any) => {
    const idsToMove = batchFileIds.length > 0 ? batchFileIds : (selectedFile ? [selectedFile.id] : [])
    if (idsToMove.length === 0 || !spaceIdNum) return

    const data = {
      spaceId: spaceIdNum,
      folderId: values.folderId || null
    }
    setMoveSubmitting(true)
    try {
      let success = 0
      let fail = 0
      for (const fileId of idsToMove) {
        try {
          await api.patch(`/files/${fileId}/move`, data)
          success += 1
        } catch {
          fail += 1
        }
      }
      setMoveFileModalVisible(false)
      setSelectedFile(null)
      setBatchFileIds([])
      moveFileForm.resetFields()
      clearCurrentBatchSelection()
      refetchFileTree()
      refetchSpaceDetail()
      if (selectedFolderId) refetchFolderFiles()
      queryClient.invalidateQueries({ queryKey: ['files'] })
      if (fail === 0) {
        message.success(idsToMove.length > 1 ? `已成功移动 ${success} 个文件` : '文件移动成功')
      } else {
        message.warning(`移动完成：成功 ${success} 个，失败 ${fail} 个`)
      }
    } catch (error: any) {
      message.error(error.message || '移动失败')
    } finally {
      setMoveSubmitting(false)
    }
  }

  const handleBatchDeleteInSpace = async () => {
    if (batchCount === 0) return
    const ids = batchIds as number[]
    try {
      let success = 0
      for (const id of ids) {
        try {
          await api.delete(`/files/${id}`)
          success += 1
        } catch {}
      }
      message.success(`已将 ${success} 个文件移至回收站`)
      clearCurrentBatchSelection()
      refetchSpaceDetail()
      refetchFileTree()
      if (selectedFolderId) refetchFolderFiles()
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (e: any) {
      message.error(e?.message || '批量删除失败')
    }
  }

  const handleBatchRemoveFromSpace = async () => {
    if (batchCount === 0) return
    const ids = batchIds as number[]
    try {
      let success = 0
      for (const id of ids) {
        try {
          await api.patch(`/files/${id}/remove-from-space`)
          success += 1
        } catch {}
      }
      message.success(`已从空间移除 ${success} 个文件`)
      clearCurrentBatchSelection()
      refetchSpaceDetail()
      refetchFileTree()
      if (selectedFolderId) refetchFolderFiles()
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (e: any) {
      message.error(e?.message || '批量移除失败')
    }
  }

  const handleDownload = async (fileId: number, fileName: string) => {
    try {
      const res = await fetch(`/api/files/download/${fileId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
      if (!res.ok) throw new Error('下载失败')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      window.URL.revokeObjectURL(url)
      message.success('下载成功')
    } catch (e: any) {
      message.error(e.message || '下载失败')
    }
  }

  const handleRenameFile = (file: any) => {
    setSelectedFile(file)
    renameFileForm.setFieldsValue({ newName: file.original_name })
    setRenameFileModalVisible(true)
  }

  const handleRenameFileConfirm = async (values: any) => {
    if (!selectedFile) return
    try {
      await api.patch(`/files/${selectedFile.id}/rename`, { newName: values.newName })
      message.success('重命名成功')
      setRenameFileModalVisible(false)
      setSelectedFile(null)
      renameFileForm.resetFields()
      refetchSpaceDetail()
      refetchFileTree()
      if (selectedFolderId) refetchFolderFiles()
    } catch (e: any) {
      message.error(e.message || '重命名失败')
    }
  }

  const handleDeleteFile = async (fileId: number) => {
    try {
      await api.delete(`/files/${fileId}`)
      message.success('文件已移至回收站')
      refetchSpaceDetail()
      refetchFileTree()
      if (selectedFolderId) refetchFolderFiles()
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (e: any) {
      message.error(e.message || '删除失败')
    }
  }

  const handleRemoveFromSpace = async (fileId: number) => {
    try {
      await api.patch(`/files/${fileId}/remove-from-space`)
      message.success('文件已从空间移除')
      refetchSpaceDetail()
      refetchFileTree()
      if (selectedFolderId) refetchFolderFiles()
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (e: any) {
      message.error(e.message || '移除失败')
    }
  }

  // 将文件夹和文件数据转换为树形结构
  const buildFileTree = (folders: any[], rootFiles: any[] = []): DataNode[] => {
    const treeNodes: DataNode[] = []
    
    // 添加根目录下的文件
    rootFiles.forEach((file: any) => {
      const perms = file?.user_permissions || {}
      const canWrite = file?.created_by === user?.id || user?.role === 'admin' || perms.write
      treeNodes.push({
        title: (
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <a
              href={`/files/${file.id}`}
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/files/${file.id}`)
              }}
            >
              {file.original_name}
            </a>
            {canWrite && (
              <Button
                type="link"
                size="small"
                icon={<FolderOpenOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  handleMoveFile(file)
                }}
                title="移动到文件夹"
              >
                移动
              </Button>
            )}
          </Space>
        ),
        key: `file-${file.id}`,
        icon: <FileOutlined />,
        isLeaf: true
      })
    })
    
    // 添加文件夹及其子节点
    folders.forEach(folder => {
      const folderFiles = folder.files || []
      const children: DataNode[] = []
      
      // 添加文件夹中的文件
      folderFiles.forEach((file: any) => {
        const perms = file?.user_permissions || {}
        const canWrite = file?.created_by === user?.id || user?.role === 'admin' || perms.write
        children.push({
          title: (
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <a
                href={`/files/${file.id}`}
                onClick={(e) => {
                  e.stopPropagation()
                  navigate(`/files/${file.id}`)
                }}
              >
                {file.original_name}
              </a>
              {canWrite && (
                <Button
                  type="link"
                  size="small"
                  icon={<FolderOpenOutlined />}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleMoveFile(file)
                  }}
                  title="移动到文件夹"
                >
                  移动
                </Button>
              )}
            </Space>
          ),
          key: `file-${file.id}`,
          icon: <FileOutlined />,
          isLeaf: true
        })
      })
      
      // 递归添加子文件夹
      if (folder.children && folder.children.length > 0) {
        children.push(...buildFileTree(folder.children, []))
      }
      
      treeNodes.push({
        title: (
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <span>
              {folder.name}
              {folderFiles.length > 0 && (
                <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '12px' }}>
                  ({folderFiles.length} 个文件)
                </span>
              )}
            </span>
            <Space onClick={(e) => e.stopPropagation()}>
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  handleOpenRenameFolder(folder)
                }}
              >
                重命名
              </Button>
              <Popconfirm
                title="确定要删除该文件夹吗？"
                onConfirm={(e) => {
                  e?.stopPropagation()
                  handleDeleteFolder(folder.id)
                }}
                okText="确定"
                cancelText="取消"
              >
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(e) => e.stopPropagation()}
                >
                  删除
                </Button>
              </Popconfirm>
            </Space>
          </Space>
        ),
        key: `folder-${folder.id}`,
        icon: <FolderOutlined />,
        children: children.length > 0 ? children : undefined
      })
    })
    
    return treeNodes
  }

  // 将文件夹数据转换为树形结构（仅文件夹，用于旧版文件夹标签页）
  const buildFolderTree = (folders: any[]): DataNode[] => {
    return folders.map(folder => ({
      title: (
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <span>{folder.name} ({folder.file_count || 0} 个文件)</span>
          <Space>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                handleOpenRenameFolder(folder)
              }}
            >
              重命名
            </Button>
            <Popconfirm
              title="确定要删除该文件夹吗？"
              onConfirm={(e) => {
                e?.stopPropagation()
                handleDeleteFolder(folder.id)
              }}
              okText="确定"
              cancelText="取消"
            >
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={(e) => e.stopPropagation()}
              >
                删除
              </Button>
            </Popconfirm>
          </Space>
        </Space>
      ),
      key: folder.id.toString(),
      icon: <FolderOutlined />,
      children: folder.children ? buildFolderTree(folder.children) : []
    }))
  }

  // 权限类型映射
  const permissionTypeMap: Record<string, string> = {
    read: '查看',
    write: '编辑',
    delete: '删除',
    comment: '评论',
    download: '下载'
  }

  // 空间类型映射
  const spaceTypeMap: Record<string, string> = {
    team: '团队公共空间',
    department: '部门空间',
    personal: '个人空间',
    project: '项目专属空间'
  }

  // 成员列表表格列
  const memberColumns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username'
    },
    {
      title: '真实姓名',
      dataIndex: 'real_name',
      key: 'real_name'
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email'
    },
    {
      title: '权限',
      dataIndex: 'permissions',
      key: 'permissions',
      render: (permissions: string[]) => (
        <Space>
          {permissions.map(perm => (
            <Tag key={perm} color="blue">{permissionTypeMap[perm] || perm}</Tag>
          ))}
        </Space>
      )
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Popconfirm
          title="确定要移除该成员吗？"
          onConfirm={() => handleRemoveMember(record.id)}
          okText="确定"
          cancelText="取消"
        >
          <Button type="link" danger size="small">移除</Button>
        </Popconfirm>
      )
    }
  ]

  if (spaceLoading) {
    return <div>加载中...</div>
  }

  if (!spaceDetail?.data) {
    return <div>空间不存在</div>
  }

  const space = spaceDetail.data

  return (
    <div className="page-content">
      <Breadcrumb style={{ marginBottom: 16 }}>
        <Breadcrumb.Item>
          <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/spaces')}>
            返回空间列表
          </Button>
        </Breadcrumb.Item>
        <Breadcrumb.Item>{space.name}</Breadcrumb.Item>
      </Breadcrumb>

      <Card>
        <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
          <div>
            <Title level={2} style={{ margin: 0 }}>{space.name}</Title>
            <div style={{ marginTop: 8, color: 'var(--text-secondary)' }}>
              {spaceTypeMap[space.type] || space.type}
              {space.description && ` • ${space.description}`}
            </div>
          </div>
          <Space>
            <Button icon={<UserOutlined />} onClick={handleManageMembers}>
              成员管理
            </Button>
            <Button icon={<SettingOutlined />} onClick={handleOpenSettings}>
              设置
            </Button>
          </Space>
        </Space>

        <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <Input
            placeholder="搜索本空间内的文件..."
            prefix={<SearchOutlined />}
            allowClear
            value={spaceSearchKeyword}
            onChange={(e) => setSpaceSearchKeyword(e.target.value)}
            style={{ maxWidth: 400 }}
          />
          {batchCount > 0 && (
            <Space wrap>
              <span style={{ color: 'var(--text-secondary)' }}>已选 {batchCount} 个文件</span>
              <Button type="default" icon={<FolderOpenOutlined />} onClick={handleBatchMoveInSpace}>
                批量移动
              </Button>
              <Popconfirm
                title={`确定将选中的 ${batchCount} 个文件移至回收站吗？`}
                onConfirm={handleBatchDeleteInSpace}
                okText="确定"
                cancelText="取消"
                okType="danger"
              >
                <Button type="default" danger icon={<DeleteOutlined />}>
                  批量删除
                </Button>
              </Popconfirm>
              <Popconfirm
                title={`确定将选中的 ${batchCount} 个文件从本空间移除吗？`}
                onConfirm={handleBatchRemoveFromSpace}
                okText="确定"
                cancelText="取消"
              >
                <Button type="default" icon={<FolderOutlined />}>
                  从空间移除
                </Button>
              </Popconfirm>
              <Button type="link" onClick={clearBatchSelection}>
                取消选择
              </Button>
            </Space>
          )}
        </div>

        {debouncedSpaceSearch.trim() ? (
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, color: 'var(--text-secondary)' }}>
              搜索「{debouncedSpaceSearch}」共 {spaceSearchData?.data?.total ?? 0} 个结果
            </div>
            <Table
              rowSelection={{
                selectedRowKeys: searchSelectedRowKeys,
                onChange: (keys) => setSearchSelectedRowKeys(keys)
              }}
              columns={[
                {
                  title: '文件名',
                  dataIndex: 'original_name',
                  key: 'original_name',
                  render: (text: string, record: any) => (
                    <a
                      href={`/files/${record.id}`}
                      onClick={(e) => {
                        e.preventDefault()
                        navigate(`/files/${record.id}`)
                      }}
                    >
                      {text}
                    </a>
                  )
                },
                {
                  title: '所在文件夹',
                  dataIndex: 'folder_name',
                  key: 'folder_name',
                  render: (_: any, record: any) =>
                    record.folder_id ? (record.folder_name || <span style={{ color: 'var(--text-muted)' }}>已删除</span>) : <span style={{ color: 'var(--text-muted)' }}>根目录</span>
                },
                {
                  title: '大小',
                  dataIndex: 'file_size',
                  key: 'file_size',
                  render: (size: number) => {
                    if (!size) return '-'
                    if (size < 1024) return `${size} B`
                    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`
                    if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`
                    return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
                  }
                },
                { title: '上传人', dataIndex: 'creator_name', key: 'creator_name' },
                {
                  title: '上传时间',
                  dataIndex: 'created_at',
                  key: 'created_at',
                  render: (time: string) => formatDateTime(time)
                },
                {
                  title: '操作',
                  key: 'action',
                  render: (_: any, record: any) => (
                    <FileActions
                      record={record}
                      onPreview={(r) => {
                        setSelectedFile(r)
                        setPreviewFileId(r.id)
                        setPreviewVisible(true)
                      }}
                      onDownload={handleDownload}
                      onRename={handleRenameFile}
                      onMove={handleMoveFile}
                      onRemoveFromSpace={handleRemoveFromSpace}
                      onDelete={handleDeleteFile}
                    />
                  )
                }
              ]}
              dataSource={spaceSearchData?.data?.files || []}
              rowKey="id"
              loading={spaceSearchLoading}
              pagination={false}
              locale={{ emptyText: '未找到匹配的文件' }}
            />
          </div>
        ) : null}

        <Tabs
          defaultActiveKey="tree"
          items={[
            {
              key: 'tree',
              label: '文件树',
              children: (
                <div>
                  <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
                    <span>文件夹结构</span>
                    <Space>
                      <Button
                        type="default"
                        icon={<PlusOutlined />}
                        onClick={() => setFolderModalVisible(true)}
                      >
                        新建文件夹
                      </Button>
                      <Upload {...spaceUploadProps}>
                        <Button type="primary" icon={<UploadOutlined />}>
                          上传文件
                        </Button>
                      </Upload>
                    </Space>
                  </Space>
                  
                  {fileTreeData?.data ? (
                    <Tree
                      showIcon
                      defaultExpandAll
                      treeData={buildFileTree(fileTreeData.data.folders || [], fileTreeData.data.rootFiles || [])}
                      onSelect={(selectedKeys) => {
                        // 处理文件夹选择
                        const folderKey = selectedKeys.find((key) => 
                          typeof key === 'string' && key.startsWith('folder-')
                        )
                        if (folderKey) {
                          const folderId = parseInt(String(folderKey).replace('folder-', ''))
                          handleSelectFolder(folderId)
                        } else {
                          handleSelectFolder(null)
                        }
                      }}
                      selectedKeys={selectedFolderId ? [`folder-${selectedFolderId}`] : []}
                    />
                  ) : (
                    <Empty description="暂无文件和文件夹" />
                  )}
                </div>
              )
            },
            {
              key: 'files',
              label: '文件列表',
              children: (
                <div>
                  <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
                    <span>空间文件</span>
                    <Upload {...spaceUploadProps}>
                      <Button type="primary" icon={<UploadOutlined />}>
                        上传文件
                      </Button>
                    </Upload>
                  </Space>
                  <Table
                    rowSelection={{
                      selectedRowKeys: fileListSelectedRowKeys,
                      onChange: (keys) => setFileListSelectedRowKeys(keys)
                    }}
                    columns={[
                      {
                        title: '文件名',
                        dataIndex: 'original_name',
                        key: 'original_name',
                        render: (text: string, record: any) => (
                          <a
                            href={`/files/${record.id}`}
                            onClick={(e) => {
                              e.preventDefault()
                              navigate(`/files/${record.id}`)
                            }}
                          >
                            {text}
                          </a>
                        )
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
                        title: '上传时间',
                        dataIndex: 'created_at',
                        key: 'created_at',
                        render: (time: string) => formatDateTime(time)
                      },
                      {
                        title: '操作',
                        key: 'action',
                        render: (_: any, record: any) => (
                          <FileActions
                            record={record}
                            onPreview={(r) => {
                              setSelectedFile(r)
                              setPreviewFileId(r.id)
                              setPreviewVisible(true)
                            }}
                            onDownload={handleDownload}
                            onRename={handleRenameFile}
                            onMove={handleMoveFile}
                            onRemoveFromSpace={handleRemoveFromSpace}
                            onDelete={handleDeleteFile}
                          />
                        )
                      }
                    ]}
                    dataSource={space.files || []}
                    rowKey="id"
                    pagination={false}
                  />
                </div>
              )
            },
            {
              key: 'folders',
              label: '文件夹',
              children: (
                <div>
                  <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
                    <span>文件夹管理</span>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => setFolderModalVisible(true)}
                    >
                      新建文件夹
                    </Button>
                  </Space>
                  
                  {foldersData?.data && foldersData.data.length > 0 ? (
                    <Tree
                      showIcon
                      defaultExpandAll
                      treeData={buildFolderTree(foldersData.data)}
                      onSelect={(selectedKeys) => {
                        if (selectedKeys.length > 0) {
                          handleSelectFolder(parseInt(selectedKeys[0] as string))
                        } else {
                          handleSelectFolder(null)
                        }
                      }}
                      selectedKeys={selectedFolderId ? [selectedFolderId.toString()] : []}
                    />
                  ) : (
                    <Empty description="暂无文件夹，点击上方按钮创建" />
                  )}

                  {selectedFolderId && (
                    <div style={{ marginTop: 24 }}>
                      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
                        <span>文件夹中的文件</span>
                        <Upload {...spaceUploadProps}>
                          <Button type="primary" icon={<UploadOutlined />} size="small">
                            上传文件到此文件夹
                          </Button>
                        </Upload>
                      </Space>
                      <Table
                        rowSelection={{
                          selectedRowKeys: folderFilesSelectedRowKeys,
                          onChange: (keys) => setFolderFilesSelectedRowKeys(keys)
                        }}
                        columns={[
                          {
                            title: '文件名',
                            dataIndex: 'original_name',
                            key: 'original_name',
                            render: (text: string, record: any) => (
                              <a
                                href={`/files/${record.id}`}
                                onClick={(e) => {
                                  e.preventDefault()
                                  navigate(`/files/${record.id}`)
                                }}
                              >
                                {text}
                              </a>
                            )
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
                            title: '上传时间',
                            dataIndex: 'created_at',
                            key: 'created_at',
                            render: (time: string) => formatDateTime(time)
                          },
                          {
                            title: '操作',
                            key: 'action',
                            render: (_: any, record: any) => (
                              <FileActions
                                record={record}
                                onPreview={(r) => {
                                  setSelectedFile(r)
                                  setPreviewFileId(r.id)
                                  setPreviewVisible(true)
                                }}
                                onDownload={handleDownload}
                                onRename={handleRenameFile}
                                onMove={handleMoveFile}
                                onRemoveFromSpace={handleRemoveFromSpace}
                                onDelete={handleDeleteFile}
                              />
                            )
                          }
                        ]}
                        dataSource={folderFilesData?.data || []}
                        rowKey="id"
                        pagination={false}
                        size="small"
                      />
                    </div>
                  )}
                </div>
              )
            }
          ]}
        />
      </Card>

      {/* 创建文件夹弹窗 */}
      <Modal
        title="新建文件夹"
        open={folderModalVisible}
        onCancel={() => {
          setFolderModalVisible(false)
          folderForm.resetFields()
        }}
        onOk={() => folderForm.submit()}
        confirmLoading={createFolderMutation.isPending}
        width={500}
      >
        <Form
          form={folderForm}
          layout="vertical"
          onFinish={handleCreateFolder}
        >
          <Form.Item
            name="name"
            label="文件夹名称"
            rules={[
              { required: true, message: '请输入文件夹名称' },
              { min: 1, message: '文件夹名称至少1个字符' },
              { max: 100, message: '文件夹名称最多100个字符' }
            ]}
          >
            <Input placeholder="请输入文件夹名称" />
          </Form.Item>

          <Form.Item
            name="parentId"
            label="父文件夹（可选）"
          >
            <Select
              placeholder="选择父文件夹（留空表示在根目录创建）"
              allowClear
            >
              {foldersData?.data && renderFolderOptions(foldersData.data)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 重命名文件夹弹窗 */}
      <Modal
        title="重命名文件夹"
        open={renameFolderModalVisible}
        onCancel={() => {
          setRenameFolderModalVisible(false)
          setSelectedFolder(null)
          renameFolderForm.resetFields()
        }}
        onOk={() => renameFolderForm.submit()}
        confirmLoading={renameFolderMutation.isPending}
        width={500}
      >
        <Form
          form={renameFolderForm}
          layout="vertical"
          onFinish={handleRenameFolder}
        >
          <Form.Item
            name="name"
            label="文件夹名称"
            rules={[
              { required: true, message: '请输入文件夹名称' },
              { min: 1, message: '文件夹名称至少1个字符' },
              { max: 100, message: '文件夹名称最多100个字符' }
            ]}
          >
            <Input placeholder="请输入文件夹名称" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 成员管理弹窗 */}
      <Modal
        title="空间成员管理"
        open={membersModalVisible}
        onCancel={() => {
          setMembersModalVisible(false)
          memberForm.resetFields()
        }}
        footer={null}
        width={800}
      >
        <div style={{ marginBottom: 16 }}>
          <h3>空间所有者</h3>
          {membersData?.data?.owner && (
            <Card size="small">
              <Space>
                <UserOutlined />
                <span>{membersData.data.owner.real_name || membersData.data.owner.username}</span>
                <Tag color="gold">所有者</Tag>
              </Space>
            </Card>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <h3>空间成员</h3>
          <Table
            columns={memberColumns}
            dataSource={membersData?.data?.members || []}
            rowKey="id"
            pagination={false}
            size="small"
          />
        </div>

        <div>
          <h3>添加成员</h3>
          <Form
            form={memberForm}
            layout="inline"
            onFinish={handleAddMembers}
          >
            <Form.Item
              name="userIds"
              label="选择用户"
              rules={[{ required: true, message: '请选择用户' }]}
              style={{ width: 300 }}
            >
              <Select
                mode="multiple"
                placeholder="请选择用户"
                showSearch
                filterOption={(input, option: any) => {
                  const children = option?.children
                  if (typeof children === 'string') {
                    return children.toLowerCase().includes(input.toLowerCase())
                  }
                  return false
                }}
              >
                {usersData?.data?.users?.map((u: any) => (
                  <Option key={u.id} value={u.id}>
                    {u.real_name || u.username} ({u.email})
                  </Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="permissionTypes"
              label="权限类型"
              rules={[{ required: true, message: '请选择权限类型' }]}
            >
              <Select
                mode="multiple"
                placeholder="请选择权限"
                style={{ width: 200 }}
              >
                <Option value="read">查看</Option>
                <Option value="write">编辑</Option>
                <Option value="delete">删除</Option>
                <Option value="comment">评论</Option>
                <Option value="download">下载</Option>
              </Select>
            </Form.Item>

            <Form.Item>
              <Button 
                type="primary" 
                htmlType="submit"
                loading={addMembersMutation.isPending}
              >
                添加
              </Button>
            </Form.Item>
          </Form>
        </div>
      </Modal>

      {/* 空间设置弹窗 */}
      <Modal
        title="空间设置"
        open={settingsModalVisible}
        onCancel={() => {
          setSettingsModalVisible(false)
          settingsForm.resetFields()
        }}
        onOk={() => settingsForm.submit()}
        confirmLoading={updateSpaceMutation.isPending}
        width={600}
      >
        <Form
          form={settingsForm}
          layout="vertical"
          onFinish={handleUpdateSpace}
        >
          <Form.Item
            name="name"
            label="空间名称"
            rules={[
              { required: true, message: '请输入空间名称' },
              { min: 2, message: '空间名称至少2个字符' },
              { max: 50, message: '空间名称最多50个字符' }
            ]}
          >
            <Input placeholder="请输入空间名称" />
          </Form.Item>

          <Form.Item
            name="description"
            label="空间描述"
          >
            <Input.TextArea 
              placeholder="请输入空间描述（可选）"
              rows={4}
            />
          </Form.Item>

          {space && (
            <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
              <div><strong>空间类型：</strong>{spaceTypeMap[space.type] || space.type}</div>
              <div style={{ marginTop: 8 }}>
                <strong>创建时间：</strong>
                {formatDateTime(space.created_at)}
              </div>
              {space.owner_name && (
                <div style={{ marginTop: 8 }}>
                  <strong>所有者：</strong>{space.owner_name}
                </div>
              )}
            </div>
          )}
        </Form>
      </Modal>

      {/* 移动文件弹窗（支持单个与批量） */}
      <Modal
        title={batchFileIds.length > 0 ? `批量移动（${batchFileIds.length} 个文件）` : '移动文件到文件夹'}
        open={moveFileModalVisible}
        onCancel={() => {
          setMoveFileModalVisible(false)
          setSelectedFile(null)
          setBatchFileIds([])
          moveFileForm.resetFields()
        }}
        onOk={() => moveFileForm.submit()}
        confirmLoading={moveSubmitting}
        width={500}
      >
        <Form
          form={moveFileForm}
          layout="vertical"
          onFinish={handleMoveFileConfirm}
        >
          {batchFileIds.length === 0 && selectedFile && (
            <Form.Item label="文件名称">
              <Input value={selectedFile.original_name} disabled />
            </Form.Item>
          )}
          <Form.Item
            name="folderId"
            label="选择文件夹"
            extra="选择目标文件夹，留空表示移动到空间根目录"
          >
            <Select
              placeholder="选择文件夹（留空表示根目录）"
              allowClear
            >
              <Option value={null}>根目录（不分类到文件夹）</Option>
              {foldersData?.data && renderFolderOptions(foldersData.data)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 重命名文件弹窗 */}
      <Modal
        title="重命名文件"
        open={renameFileModalVisible}
        onCancel={() => {
          setRenameFileModalVisible(false)
          setSelectedFile(null)
          renameFileForm.resetFields()
        }}
        onOk={() => renameFileForm.submit()}
        width={400}
      >
        <Form form={renameFileForm} layout="vertical" onFinish={handleRenameFileConfirm}>
          <Form.Item
            name="newName"
            label="新文件名"
            rules={[{ required: true, message: '请输入新文件名' }]}
          >
            <Input placeholder="请输入新文件名" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 文件预览 */}
      <FilePreview
        fileId={previewFileId}
        fileName={selectedFile?.original_name}
        mimeType={selectedFile?.mime_type}
        visible={previewVisible}
        onClose={() => {
          setPreviewVisible(false)
          setPreviewFileId(null)
        }}
      />
    </div>
  )
}

// 递归渲染文件夹选项
function renderFolderOptions(folders: any[], level = 0): React.ReactNode[] {
  const options: React.ReactNode[] = []
  folders.forEach(folder => {
    const prefix = '  '.repeat(level)
    options.push(
      <Option key={folder.id} value={folder.id}>
        {prefix}{folder.name}
      </Option>
    )
    if (folder.children && folder.children.length > 0) {
      options.push(...renderFolderOptions(folder.children, level + 1))
    }
  })
  return options
}




