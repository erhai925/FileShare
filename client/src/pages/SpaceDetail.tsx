import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  App, Card, Button, Space, Modal, Form, Input, Select, message, Table, Tag,
  Popconfirm, Upload, Breadcrumb, Typography, Layout
} from 'antd'
import {
  FolderOutlined, PlusOutlined, UserOutlined, SettingOutlined, UploadOutlined,
  DeleteOutlined, ArrowLeftOutlined, SearchOutlined, FolderOpenOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, DownloadOutlined
} from '@ant-design/icons'
import FilePreview from '../components/FilePreview'
import ChunkUpload from '../components/ChunkUpload'
import FolderTree, { FolderNode, SelectedKey } from '../components/space/FolderTree'
import FileList from '../components/space/FileList'
import { formatDateTime } from '../utils/date'
import { downloadFile, downloadFilesAsZip } from '../utils/download'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import type { UploadProps } from 'antd'
import {
  createBatchUploadModeAsker, LARGE_FILE_THRESHOLD_BYTES,
  inflightKey, beginInflight, endInflight, reportUploadProgress, finishUploadProgress,
  clearUploadProgress, confirmDuplicateUpload
} from '../utils/uploadGuard'

const { Option } = Select
const { Title, Text } = Typography
const { Sider, Content } = Layout

const spaceTypeMap: Record<string, string> = {
  team: '团队公共空间',
  department: '部门空间',
  personal: '个人空间',
  project: '项目专属空间'
}

const permissionTypeMap: Record<string, string> = {
  read: '查看', write: '编辑', delete: '删除', comment: '评论', download: '下载'
}

// 文件夹下拉（移动文件用）的扁平化渲染，保持目录缩进
function renderFolderOptions(folders: any[], level = 0): React.ReactNode[] {
  const options: React.ReactNode[] = []
  folders.forEach(folder => {
    const prefix = '  '.repeat(level)
    options.push(
      <Option key={folder.id} value={folder.id}>{prefix}{folder.name}</Option>
    )
    if (folder.children?.length) {
      options.push(...renderFolderOptions(folder.children, level + 1))
    }
  })
  return options
}

// 从树结构中按 id 查找节点（DFS）
function findFolderById(folders: FolderNode[], id: number): FolderNode | null {
  for (const f of folders) {
    if (f.id === id) return f
    if (f.children?.length) {
      const r = findFolderById(f.children, id)
      if (r) return r
    }
  }
  return null
}

// 扁平化文件夹树
function flattenFolders(folders: FolderNode[]): FolderNode[] {
  const out: FolderNode[] = []
  const walk = (arr: FolderNode[]) => arr.forEach(n => {
    out.push(n)
    if (n.children?.length) walk(n.children)
  })
  walk(folders)
  return out
}

export default function SpaceDetail() {
  const { message: messageApi, modal: modalApi } = App.useApp()
  /** 一批多选只弹一次「选择上传方式」 */
  const askUploadModeRef = useRef(createBatchUploadModeAsker())
  /** 大文件上传窗口一次只能接手一个文件，记录本批是否已接手 */
  const chunkHandoffRef = useRef<{ list: unknown; taken: boolean } | null>(null)
  const { spaceId } = useParams<{ spaceId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // —— 核心状态：统一替代原三套独立选择
  const initialFolderParam = searchParams.get('folderId')
  const initialQ = searchParams.get('q') || ''
  const initialKey: SelectedKey = initialFolderParam ? (parseInt(initialFolderParam) || 'all') : 'all'
  const [selectedKey, setSelectedKey] = useState<SelectedKey>(initialKey)
  const [searchKeyword, setSearchKeyword] = useState(initialQ)
  const [debouncedSearch, setDebouncedSearch] = useState(initialQ)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  // 分页：all / folder 模式各自一套
  const [allPage, setAllPage] = useState(1)
  const [allPageSize, setAllPageSize] = useState(50)
  const [folderPage, setFolderPage] = useState(1)
  const [folderPageSize, setFolderPageSize] = useState(50)

  // 各 Modal 显隐
  const [folderModalVisible, setFolderModalVisible] = useState(false)
  const [renameFolderModalVisible, setRenameFolderModalVisible] = useState(false)
  const [membersModalVisible, setMembersModalVisible] = useState(false)
  const [settingsModalVisible, setSettingsModalVisible] = useState(false)
  const [moveFileModalVisible, setMoveFileModalVisible] = useState(false)
  const [renameFileModalVisible, setRenameFileModalVisible] = useState(false)
  const [chunkUploadVisible, setChunkUploadVisible] = useState(false)
  const [previewVisible, setPreviewVisible] = useState(false)

  // 当前操作选中项
  const [selectedFolder, setSelectedFolder] = useState<FolderNode | null>(null)
  const [selectedFile, setSelectedFile] = useState<any>(null)
  const [previewFileId, setPreviewFileId] = useState<number | null>(null)
  const [batchFileIds, setBatchFileIds] = useState<number[]>([])
  const [moveSubmitting, setMoveSubmitting] = useState(false)
  const [chunkUploadPendingFile, setChunkUploadPendingFile] = useState<File | null>(null)
  const [siderCollapsed, setSiderCollapsed] = useState(false)

  // Forms
  const [folderForm] = Form.useForm()
  const [renameFolderForm] = Form.useForm()
  const [memberForm] = Form.useForm()
  const [settingsForm] = Form.useForm()
  const [moveFileForm] = Form.useForm()
  const [renameFileForm] = Form.useForm()

  const spaceIdNum = spaceId ? parseInt(spaceId) : null
  const mode: 'all' | 'folder' | 'search' = debouncedSearch.trim()
    ? 'search'
    : selectedKey === 'all' ? 'all' : 'folder'

  // —— URL 同步（folderId + q）
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (selectedKey === 'all') next.delete('folderId')
    else next.set('folderId', String(selectedKey))
    if (debouncedSearch.trim()) next.set('q', debouncedSearch.trim())
    else next.delete('q')
    // 仅当真有变化时 setSearchParams，避免循环
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
  }, [selectedKey, debouncedSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  // —— 搜索 debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchKeyword), 400)
    return () => clearTimeout(t)
  }, [searchKeyword])

  // 切换 mode 或选中项时清空 selection（避免误删跨文件夹的文件）
  useEffect(() => { setSelectedRowKeys([]) }, [mode, selectedKey, debouncedSearch])

  // 文件夹切换重置分页
  useEffect(() => { setFolderPage(1) }, [selectedKey])

  // —— 查询
  const { data: spaceDetail, isLoading: spaceLoading, refetch: refetchSpaceDetail } = useQuery({
    queryKey: ['space-detail', spaceIdNum, allPage, allPageSize],
    queryFn: () => api.get(`/spaces/${spaceIdNum}`, { params: { filePage: allPage, filePageSize: allPageSize } }),
    enabled: !!spaceIdNum
  })

  const { data: foldersData, refetch: refetchFolders } = useQuery({
    queryKey: ['space-folders', spaceIdNum],
    queryFn: () => api.get(`/spaces/${spaceIdNum}/folders`),
    enabled: !!spaceIdNum
  })

  const { data: folderFilesData, refetch: refetchFolderFiles } = useQuery({
    queryKey: ['folder-files', spaceIdNum, selectedKey, folderPage, folderPageSize],
    queryFn: () => api.get(`/spaces/${spaceIdNum}/folders/${selectedKey}/files`, {
      params: { page: folderPage, pageSize: folderPageSize }
    }),
    enabled: !!spaceIdNum && mode === 'folder' && typeof selectedKey === 'number'
  })

  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ['space-search', spaceIdNum, debouncedSearch],
    queryFn: () => api.get('/search', {
      params: { keyword: debouncedSearch, spaceId: spaceIdNum, pageSize: 100 }
    }),
    enabled: !!spaceIdNum && !!debouncedSearch.trim()
  })

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users'),
    enabled: false
  })

  const { data: membersData, refetch: refetchMembers } = useQuery({
    queryKey: ['space-members', spaceIdNum],
    queryFn: () => api.get(`/spaces/${spaceIdNum}/members`),
    enabled: !!spaceIdNum && membersModalVisible
  })

  // —— Mutations
  const createFolderMutation = useMutation({
    mutationFn: ({ data }: { data: any }) => api.post(`/spaces/${spaceIdNum}/folders`, data),
    onSuccess: () => {
      message.success('文件夹创建成功')
      setFolderModalVisible(false)
      folderForm.resetFields()
      refetchFolders()
    },
    onError: (e: any) => message.error(e?.message || '创建文件夹失败')
  })

  const renameFolderMutation = useMutation({
    mutationFn: ({ folderId, data }: { folderId: number, data: any }) =>
      api.put(`/spaces/${spaceIdNum}/folders/${folderId}`, data),
    onSuccess: () => {
      message.success('文件夹重命名成功')
      setRenameFolderModalVisible(false)
      setSelectedFolder(null)
      renameFolderForm.resetFields()
      refetchFolders()
    },
    onError: (e: any) => message.error(e?.message || '重命名文件夹失败')
  })

  const deleteFolderMutation = useMutation({
    mutationFn: ({ folderId }: { folderId: number }) =>
      api.delete(`/spaces/${spaceIdNum}/folders/${folderId}`),
    onSuccess: () => {
      message.success('文件夹删除成功')
      // 如果删的是当前选中，回退到「全部文件」
      if (selectedKey !== 'all') setSelectedKey('all')
      refetchFolders()
    },
    onError: (e: any) => message.error(e?.message || '删除文件夹失败')
  })

  const moveFolderMutation = useMutation({
    mutationFn: ({ folderId, parentId }: { folderId: number, parentId: number | null }) =>
      api.put(`/spaces/${spaceIdNum}/folders/${folderId}/move`, { parentId }),
    onSuccess: () => {
      message.success('文件夹移动成功')
      refetchFolders()
    },
    onError: (e: any) => message.error(e?.message || '移动文件夹失败')
  })

  const addMembersMutation = useMutation({
    mutationFn: ({ data }: { data: any }) => api.post(`/spaces/${spaceIdNum}/members`, data),
    onSuccess: () => {
      message.success('成员添加成功')
      memberForm.resetFields()
      refetchMembers()
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
    },
    onError: (e: any) => message.error(e?.message || '添加成员失败')
  })

  const removeMemberMutation = useMutation({
    mutationFn: ({ userId }: { userId: number }) =>
      api.delete(`/spaces/${spaceIdNum}/members/${userId}`),
    onSuccess: () => {
      message.success('成员已移除')
      refetchMembers()
    },
    onError: (e: any) => message.error(e?.message || '移除成员失败')
  })

  const updateSpaceMutation = useMutation({
    mutationFn: ({ data }: { data: any }) => api.put(`/spaces/${spaceIdNum}`, data),
    onSuccess: () => {
      message.success('空间信息更新成功')
      setSettingsModalVisible(false)
      settingsForm.resetFields()
      refetchSpaceDetail()
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
    },
    onError: (e: any) => message.error(e?.message || '更新空间信息失败')
  })

  // —— Upload
  const spaceUploadProps: UploadProps = {
    name: 'file',
    multiple: true,
    // 原为 false：上传期间页面毫无反馈，用户以为没反应就反复点，同一份文件多次入库
    showUploadList: true,
    customRequest: async ({ file, onSuccess, onError, onProgress }) => {
      const f = file as File
      const key = inflightKey(f)
      const post = (force: boolean) => {
        const formData = new FormData()
        formData.append('file', f)
        formData.append('spaceId', String(spaceIdNum ?? ''))
        // 上传到当前选中文件夹；「全部文件」视为根目录
        formData.append('folderId', String(typeof selectedKey === 'number' ? selectedKey : ''))
        if (force) formData.append('force', '1')
        return api.post('/files/upload', formData, {
          timeout: 300000,
          onUploadProgress: (e) => {
            const percent = reportUploadProgress(e, f, messageApi, key)
            onProgress?.({ percent })
          }
        })
      }
      try {
        let res: unknown
        try {
          res = await post(false)
        } catch (err: any) {
          // 409：同目录已有相同内容的文件，问过用户再决定是否带 force 重传
          if (err?.code !== 'DUPLICATE_CONTENT') throw err
          clearUploadProgress(messageApi, key)
          const goOn = await confirmDuplicateUpload(err.message || '当前目录已存在相同内容的文件', modalApi)
          if (!goOn) {
            messageApi.info(`已取消上传「${f.name}」`)
            onError?.(new Error('用户取消：文件重复'))
            return
          }
          res = await post(true)
        }
        const data = res as any
        if (data?.success) {
          finishUploadProgress(messageApi, key, true, data.message || `${f.name} 上传成功`)
          onSuccess?.(data)
        } else {
          const m = data?.message || '上传失败'
          finishUploadProgress(messageApi, key, false, `${f.name}：${m}`)
          onError?.(new Error(m))
        }
      } catch (err: any) {
        const msg = typeof err === 'string' ? err : (err?.message || err?.response?.data?.message || '上传失败')
        finishUploadProgress(messageApi, key, false, `${f.name}：${msg}`)
        onError?.(new Error(msg))
      } finally {
        endInflight(f)
      }
    },
    onChange(info) {
      // 成功/失败文案已由 customRequest 就地给出，此处只刷新列表，避免重复提示
      if (info.file.status === 'done') {
        if (info.file.response?.success) {
          refetchSpaceDetail()
          refetchFolders()
          if (mode === 'folder') refetchFolderFiles()
          queryClient.invalidateQueries({ queryKey: ['files'] })
        }
      } else if (info.file.status === 'error') {
        if (info.file.size && info.file.size > LARGE_FILE_THRESHOLD_BYTES) {
          message.info('大文件建议使用「大文件上传（断点续传）」')
        }
      }
    },
    beforeUpload: async (file, fileList) => {
      // 同名同大小的文件正在传输中：拦掉重复提交，避免同一份文件多次入库
      if (!beginInflight(file)) {
        messageApi.warning(`「${file.name}」正在上传中，请勿重复提交`)
        return Upload.LIST_IGNORE
      }
      const mode = await askUploadModeRef.current(file, fileList, modalApi)
      if (mode === 'normal') return true
      endInflight(file) // 转大文件上传，普通上传的登记就地释放

      // 转大文件上传：窗口一次只能接手一个文件，同批其余大文件提示单独上传
      if (chunkHandoffRef.current?.list !== fileList) {
        chunkHandoffRef.current = { list: fileList, taken: false }
      }
      if (chunkHandoffRef.current.taken) {
        messageApi.info(`「${file.name}」未上传：大文件上传一次只处理一个文件，请稍后单独上传`)
        return Upload.LIST_IGNORE
      }
      chunkHandoffRef.current.taken = true
      setChunkUploadPendingFile(file)
      setChunkUploadVisible(true)
      return Upload.LIST_IGNORE
    }
  }

  // —— Handlers
  const handleCreateFolder = async (values: any) => {
    if (!spaceIdNum) return
    // 默认在当前选中文件夹下创建
    const parentId = values.parentId ?? (typeof selectedKey === 'number' ? selectedKey : null)
    await createFolderMutation.mutateAsync({ data: { ...values, parentId } })
  }

  const handleRenameFolder = async (values: any) => {
    if (!selectedFolder) return
    await renameFolderMutation.mutateAsync({ folderId: selectedFolder.id, data: values })
  }

  const handleMoveFile = (file: any) => {
    setSelectedFile(file)
    setBatchFileIds([])
    moveFileForm.setFieldsValue({ folderId: file.folder_id || null })
    setMoveFileModalVisible(true)
  }

  const handleBatchMove = () => {
    if (selectedRowKeys.length === 0) return
    setSelectedFile(null)
    setBatchFileIds(selectedRowKeys as number[])
    moveFileForm.setFieldsValue({ folderId: null })
    setMoveFileModalVisible(true)
  }

  const handleMoveFileConfirm = async (values: any) => {
    const ids = batchFileIds.length > 0 ? batchFileIds : (selectedFile ? [selectedFile.id] : [])
    if (ids.length === 0 || !spaceIdNum) return
    const data = { spaceId: spaceIdNum, folderId: values.folderId || null }
    setMoveSubmitting(true)
    try {
      let success = 0, fail = 0
      for (const id of ids) {
        try { await api.patch(`/files/${id}/move`, data); success++ } catch { fail++ }
      }
      setMoveFileModalVisible(false)
      setSelectedFile(null); setBatchFileIds([])
      moveFileForm.resetFields()
      setSelectedRowKeys([])
      refetchSpaceDetail(); refetchFolders()
      if (mode === 'folder') refetchFolderFiles()
      queryClient.invalidateQueries({ queryKey: ['files'] })
      if (fail === 0) message.success(ids.length > 1 ? `已成功移动 ${success} 个文件` : '文件移动成功')
      else message.warning(`移动完成：成功 ${success} 个，失败 ${fail} 个`)
    } finally {
      setMoveSubmitting(false)
    }
  }

  // 拖拽：文件 → 文件夹
  const handleDropFileToFolder = async (fileId: number, targetFolderId: number) => {
    if (!spaceIdNum) return
    try {
      await api.patch(`/files/${fileId}/move`, { spaceId: spaceIdNum, folderId: targetFolderId })
      message.success('文件已移动')
      refetchSpaceDetail()
      if (mode === 'folder') refetchFolderFiles()
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (e: any) {
      message.error(e?.message || '移动失败')
    }
  }

  // 拖拽：文件夹 → 文件夹
  const handleDropFolderToFolder = (dragId: number, dropId: number | null) => {
    moveFolderMutation.mutate({ folderId: dragId, parentId: dropId })
  }

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return
    let success = 0
    for (const id of selectedRowKeys) {
      try { await api.delete(`/files/${id}`); success++ } catch {}
    }
    message.success(`已将 ${success} 个文件移至回收站`)
    setSelectedRowKeys([])
    refetchSpaceDetail(); refetchFolders()
    if (mode === 'folder') refetchFolderFiles()
    queryClient.invalidateQueries({ queryKey: ['files'] })
  }

  const handleBatchRemoveFromSpace = async () => {
    if (selectedRowKeys.length === 0) return
    let success = 0
    for (const id of selectedRowKeys) {
      try { await api.patch(`/files/${id}/remove-from-space`); success++ } catch {}
    }
    message.success(`已从空间移除 ${success} 个文件`)
    setSelectedRowKeys([])
    refetchSpaceDetail(); refetchFolders()
    if (mode === 'folder') refetchFolderFiles()
    queryClient.invalidateQueries({ queryKey: ['files'] })
  }

  // 走浏览器原生下载，不再 fetch+blob（大文件会因内存压力中断留下 .crdownload）
  const handleDownload = async (fileId: number) => {
    try {
      await downloadFile(fileId)
      messageApi.success('已开始下载，请查看浏览器下载列表')
    } catch (e: any) {
      messageApi.error(e?.message || '下载失败')
    }
  }

  // 批量下载：服务端流式打 zip
  const handleBatchDownload = async (fileIds: number[]) => {
    if (!fileIds.length) return
    const hide = messageApi.loading('正在准备打包，请稍候...', 0)
    try {
      const r = await downloadFilesAsZip(fileIds)
      hide()
      if (r.skipped > 0) {
        messageApi.warning(`已开始下载 ${r.included} 个文件，${r.skipped} 个因无权限被跳过`)
      } else {
        messageApi.success(`已开始打包下载 ${r.included} 个文件，请查看浏览器下载列表`)
      }
    } catch (e: any) {
      hide()
      messageApi.error(e?.message || '批量下载失败')
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
      setRenameFileModalVisible(false); setSelectedFile(null)
      renameFileForm.resetFields()
      refetchSpaceDetail()
      if (mode === 'folder') refetchFolderFiles()
    } catch (e: any) { message.error(e?.message || '重命名失败') }
  }

  const handleDeleteFile = async (fileId: number) => {
    try {
      await api.delete(`/files/${fileId}`)
      message.success('文件已移至回收站')
      refetchSpaceDetail(); refetchFolders()
      if (mode === 'folder') refetchFolderFiles()
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (e: any) { message.error(e?.message || '删除失败') }
  }

  const handleRemoveFromSpace = async (fileId: number) => {
    try {
      await api.patch(`/files/${fileId}/remove-from-space`)
      message.success('文件已从空间移除')
      refetchSpaceDetail(); refetchFolders()
      if (mode === 'folder') refetchFolderFiles()
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (e: any) { message.error(e?.message || '移除失败') }
  }

  const handleTreeContextAction = (action: 'create' | 'rename' | 'delete', folderId: number) => {
    const folder = findFolderById(foldersData?.data || [], folderId)
    if (!folder) return
    setSelectedFolder(folder)
    if (action === 'create') {
      folderForm.setFieldsValue({ parentId: folderId, name: '' })
      setFolderModalVisible(true)
    } else if (action === 'rename') {
      renameFolderForm.setFieldsValue({ name: folder.name })
      setRenameFolderModalVisible(true)
    } else if (action === 'delete') {
      Modal.confirm({
        title: '删除文件夹？',
        content: `将删除「${folder.name}」。若包含文件或子文件夹，将无法删除。`,
        okType: 'danger',
        onOk: () => deleteFolderMutation.mutate({ folderId })
      })
    }
  }

  // —— 计算面包屑（folder 模式下）
  const breadcrumbItems = useMemo(() => {
    if (mode !== 'folder' || typeof selectedKey !== 'number') return undefined
    const all = flattenFolders(foldersData?.data || [])
    const items: { id: number, name: string }[] = []
    let cur = all.find(f => f.id === selectedKey) || null
    while (cur) {
      items.unshift({ id: cur.id, name: cur.name })
      cur = cur.parent_id ? (all.find(f => f.id === cur!.parent_id) || null) : null
    }
    return [
      { key: 'all', title: '全部文件', onClick: () => setSelectedKey('all') },
      ...items.map((it, idx) => ({
        key: String(it.id),
        title: it.name,
        onClick: idx < items.length - 1 ? () => setSelectedKey(it.id) : undefined
      }))
    ]
  }, [foldersData, selectedKey, mode])

  // —— 计算当前 mode 下用于表格的数据
  const tableData = useMemo(() => {
    if (mode === 'search') {
      const list = searchData?.data?.files || []
      return { files: list, total: searchData?.data?.total ?? list.length, loading: searchLoading }
    }
    if (mode === 'folder') {
      const list = folderFilesData?.data?.files || folderFilesData?.data || []
      return { files: list, total: folderFilesData?.data?.total ?? list.length, loading: false }
    }
    // all
    const sp: any = spaceDetail?.data
    return { files: sp?.files || [], total: sp?.filesTotal ?? (sp?.files?.length || 0), loading: spaceLoading }
  }, [mode, searchData, searchLoading, folderFilesData, spaceDetail, spaceLoading])

  // 成员表格列（弹窗里用）
  const memberColumns = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '真实姓名', dataIndex: 'real_name', key: 'real_name' },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    {
      title: '权限', dataIndex: 'permissions', key: 'permissions',
      render: (perms: string[]) => (
        <Space>{perms.map(p => <Tag key={p} color="blue">{permissionTypeMap[p] || p}</Tag>)}</Space>
      )
    },
    {
      title: '操作', key: 'action',
      render: (_: any, record: any) => (
        <Popconfirm title="确定要移除该成员吗？" onConfirm={() => removeMemberMutation.mutate({ userId: record.id })}>
          <Button type="link" danger size="small">移除</Button>
        </Popconfirm>
      )
    }
  ]

  if (spaceLoading) return <div>加载中...</div>
  if (!spaceDetail?.data) return <div>空间不存在</div>

  const space = spaceDetail.data
  const canWrite = true // 简化处理：后端会兜底校验；前端隐藏入口由角色等约束，沿用既有逻辑
  const batchCount = selectedRowKeys.length

  return (
    <div className="page-content" style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Breadcrumb style={{ marginBottom: 12 }}>
        <Breadcrumb.Item>
          <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/spaces')}>返回空间列表</Button>
        </Breadcrumb.Item>
        <Breadcrumb.Item>
          <Typography.Text ellipsis={{ tooltip: space.name }}>{space.name}</Typography.Text>
        </Breadcrumb.Item>
      </Breadcrumb>

      <Card style={{ flex: 1, display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16 }}>
        {/* 顶部：空间标题 + 全局操作 */}
        <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Title level={3} style={{ margin: 0 }}>
              <Typography.Text ellipsis={{ tooltip: space.name }}>{space.name}</Typography.Text>
            </Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {spaceTypeMap[space.type] || space.type}
              {space.description && ` · ${space.description}`}
            </Text>
          </div>
          <Space>
            <Button icon={<UserOutlined />} onClick={() => {
              setMembersModalVisible(true)
              queryClient.fetchQuery({ queryKey: ['users'] })
            }}>成员管理</Button>
            <Button icon={<SettingOutlined />} onClick={() => {
              setSettingsModalVisible(true)
              settingsForm.setFieldsValue({ name: space.name, description: space.description })
            }}>设置</Button>
          </Space>
        </Space>

        {/* 工具栏：搜索 + 上传 + 新建 */}
        <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <Input
            placeholder="搜索本空间内的文件..."
            prefix={<SearchOutlined />}
            allowClear
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            style={{ maxWidth: 360, flex: 1, minWidth: 180 }}
          />
          <Space wrap>
            <Upload {...spaceUploadProps}>
              <Button type="primary" icon={<UploadOutlined />}>上传文件</Button>
            </Upload>
            <Button icon={<PlusOutlined />} onClick={() => {
              folderForm.resetFields()
              folderForm.setFieldsValue({ parentId: typeof selectedKey === 'number' ? selectedKey : null })
              setFolderModalVisible(true)
            }}>新建文件夹</Button>
            <Button onClick={() => setChunkUploadVisible(true)}>大文件上传</Button>
          </Space>
        </div>

        {/* 批量操作栏（仅在有选择时出现） */}
        {batchCount > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Space wrap>
              <Text type="secondary">已选 {batchCount} 个文件</Text>
              <Button type="primary" icon={<DownloadOutlined />} onClick={() => handleBatchDownload(selectedRowKeys as number[])}>批量下载</Button>
              <Button icon={<FolderOpenOutlined />} onClick={handleBatchMove}>批量移动</Button>
              <Popconfirm title={`确定将选中的 ${batchCount} 个文件移至回收站吗？`} okType="danger" onConfirm={handleBatchDelete}>
                <Button danger icon={<DeleteOutlined />}>批量删除</Button>
              </Popconfirm>
              <Popconfirm title={`确定将选中的 ${batchCount} 个文件从本空间移除吗？`} onConfirm={handleBatchRemoveFromSpace}>
                <Button icon={<FolderOutlined />}>从空间移除</Button>
              </Popconfirm>
              <Button type="link" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </Space>
          </div>
        )}

        {/* 主体：左 Sider + 右 Content */}
        <Layout style={{ flex: 1, background: 'transparent', minHeight: 0 }}>
          <Sider
            theme="light"
            width={280}
            collapsedWidth={48}
            collapsible
            collapsed={siderCollapsed}
            trigger={null}
            style={{
              background: '#fff',
              border: '1px solid #f0f0f0',
              borderRadius: 6,
              marginRight: 12,
              overflow: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 4 }}>
              <Button
                type="text"
                size="small"
                icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setSiderCollapsed(v => !v)}
              />
            </div>
            {!siderCollapsed && (
              <FolderTree
                folders={(foldersData?.data || []) as FolderNode[]}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                onFolderDrop={handleDropFolderToFolder}
                onFileDrop={handleDropFileToFolder}
                onContextAction={handleTreeContextAction}
                canWrite={canWrite}
              />
            )}
          </Sider>

          <Content style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 6, padding: 12, overflow: 'auto' }}>
            <FileList
              mode={mode}
              files={tableData.files}
              total={tableData.total}
              loading={tableData.loading}
              page={mode === 'folder' ? folderPage : allPage}
              pageSize={mode === 'folder' ? folderPageSize : allPageSize}
              onPageChange={(p, s) => {
                if (mode === 'folder') { setFolderPage(p); setFolderPageSize(s) }
                else { setAllPage(p); setAllPageSize(s) }
              }}
              selectedRowKeys={selectedRowKeys}
              onSelectChange={setSelectedRowKeys}
              breadcrumb={breadcrumbItems}
              searchKeyword={debouncedSearch}
              onClearSearch={() => { setSearchKeyword(''); setDebouncedSearch('') }}
              onPreview={(r) => { setSelectedFile(r); setPreviewFileId(r.id); setPreviewVisible(true) }}
              onDownload={handleDownload}
              onRename={handleRenameFile}
              onMove={handleMoveFile}
              onRemoveFromSpace={handleRemoveFromSpace}
              onDelete={handleDeleteFile}
              emptyExtra={
                <Upload {...spaceUploadProps}>
                  <Button type="primary" icon={<UploadOutlined />} style={{ marginTop: 8 }}>上传文件</Button>
                </Upload>
              }
            />
          </Content>
        </Layout>
      </Card>

      {/* —— 创建文件夹 */}
      <Modal
        title="新建文件夹"
        open={folderModalVisible}
        onCancel={() => { setFolderModalVisible(false); folderForm.resetFields() }}
        onOk={() => folderForm.submit()}
        confirmLoading={createFolderMutation.isPending}
        width={500}
      >
        <Form form={folderForm} layout="vertical" onFinish={handleCreateFolder}>
          <Form.Item name="name" label="文件夹名称"
            rules={[{ required: true, message: '请输入文件夹名称' }, { max: 100, message: '最多 100 字符' }]}>
            <Input placeholder="请输入文件夹名称" autoFocus />
          </Form.Item>
          <Form.Item name="parentId" label="父文件夹（可选）">
            <Select placeholder="选择父文件夹（留空在根目录创建）" allowClear>
              {foldersData?.data && renderFolderOptions(foldersData.data)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* —— 重命名文件夹 */}
      <Modal
        title="重命名文件夹"
        open={renameFolderModalVisible}
        onCancel={() => { setRenameFolderModalVisible(false); setSelectedFolder(null); renameFolderForm.resetFields() }}
        onOk={() => renameFolderForm.submit()}
        confirmLoading={renameFolderMutation.isPending}
        width={500}
      >
        <Form form={renameFolderForm} layout="vertical" onFinish={handleRenameFolder}>
          <Form.Item name="name" label="文件夹名称"
            rules={[{ required: true, message: '请输入文件夹名称' }, { max: 100 }]}>
            <Input autoFocus />
          </Form.Item>
        </Form>
      </Modal>

      {/* —— 成员管理 */}
      <Modal
        title="空间成员管理"
        open={membersModalVisible}
        onCancel={() => { setMembersModalVisible(false); memberForm.resetFields() }}
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
          <Table columns={memberColumns} dataSource={membersData?.data?.members || []} rowKey="id" pagination={false} size="small" />
        </div>
        <div>
          <h3>添加成员</h3>
          <Form form={memberForm} layout="inline" onFinish={(vals) => addMembersMutation.mutate({ data: vals })}>
            <Form.Item name="userIds" label="选择用户" rules={[{ required: true }]} style={{ width: 300 }}>
              <Select mode="multiple" placeholder="请选择用户" showSearch
                filterOption={(input, option: any) => {
                  const c = option?.children
                  return typeof c === 'string' ? c.toLowerCase().includes(input.toLowerCase()) : false
                }}>
                {usersData?.data?.users?.map((u: any) => (
                  <Option key={u.id} value={u.id}>{u.real_name || u.username} ({u.email})</Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item name="permissionTypes" label="权限类型" rules={[{ required: true }]}>
              <Select mode="multiple" placeholder="请选择权限" style={{ width: 200 }}>
                <Option value="read">查看</Option>
                <Option value="write">编辑</Option>
                <Option value="delete">删除</Option>
                <Option value="comment">评论</Option>
                <Option value="download">下载</Option>
              </Select>
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={addMembersMutation.isPending}>添加</Button>
            </Form.Item>
          </Form>
        </div>
      </Modal>

      {/* —— 空间设置 */}
      <Modal
        title="空间设置"
        open={settingsModalVisible}
        onCancel={() => { setSettingsModalVisible(false); settingsForm.resetFields() }}
        onOk={() => settingsForm.submit()}
        confirmLoading={updateSpaceMutation.isPending}
        width={600}
      >
        <Form form={settingsForm} layout="vertical" onFinish={(vals) => updateSpaceMutation.mutate({ data: vals })}>
          <Form.Item name="name" label="空间名称" rules={[{ required: true }, { min: 2 }, { max: 50 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="空间描述">
            <Input.TextArea rows={4} />
          </Form.Item>
          {space && (
            <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
              <div><strong>空间类型：</strong>{spaceTypeMap[space.type] || space.type}</div>
              <div style={{ marginTop: 8 }}><strong>创建时间：</strong>{formatDateTime(space.created_at)}</div>
              {space.owner_name && <div style={{ marginTop: 8 }}><strong>所有者：</strong>{space.owner_name}</div>}
            </div>
          )}
        </Form>
      </Modal>

      {/* —— 移动文件（单个 / 批量） */}
      <Modal
        title={batchFileIds.length > 0 ? `批量移动（${batchFileIds.length} 个文件）` : '移动文件到文件夹'}
        open={moveFileModalVisible}
        onCancel={() => { setMoveFileModalVisible(false); setSelectedFile(null); setBatchFileIds([]); moveFileForm.resetFields() }}
        onOk={() => moveFileForm.submit()}
        confirmLoading={moveSubmitting}
        width={500}
      >
        <Form form={moveFileForm} layout="vertical" onFinish={handleMoveFileConfirm}>
          {batchFileIds.length === 0 && selectedFile && (
            <Form.Item label="文件名称"><Input value={selectedFile.original_name} disabled /></Form.Item>
          )}
          <Form.Item name="folderId" label="选择文件夹" extra="选择目标文件夹，留空表示移动到空间根目录">
            <Select placeholder="选择文件夹（留空表示根目录）" allowClear>
              <Option value="">根目录（不分类到文件夹）</Option>
              {foldersData?.data && renderFolderOptions(foldersData.data)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* —— 重命名文件 */}
      <Modal
        title="重命名文件"
        open={renameFileModalVisible}
        onCancel={() => { setRenameFileModalVisible(false); setSelectedFile(null); renameFileForm.resetFields() }}
        onOk={() => renameFileForm.submit()}
        width={400}
      >
        <Form form={renameFileForm} layout="vertical" onFinish={handleRenameFileConfirm}>
          <Form.Item name="newName" label="新文件名" rules={[{ required: true, message: '请输入新文件名' }]}>
            <Input autoFocus />
          </Form.Item>
        </Form>
      </Modal>

      {/* —— 大文件上传 */}
      <Modal
        title="大文件上传（分块上传，支持断点续传）"
        open={chunkUploadVisible}
        onCancel={() => { setChunkUploadVisible(false); setChunkUploadPendingFile(null) }}
        footer={null}
        width={520}
      >
        <ChunkUpload
          spaceId={spaceIdNum ?? undefined}
          folderId={typeof selectedKey === 'number' ? selectedKey : undefined}
          initialFile={chunkUploadPendingFile}
          onInitialFileConsumed={() => setChunkUploadPendingFile(null)}
          onSuccess={() => {
            setChunkUploadVisible(false)
            setChunkUploadPendingFile(null)
            refetchSpaceDetail(); refetchFolders()
            if (mode === 'folder') refetchFolderFiles()
            queryClient.invalidateQueries({ queryKey: ['files'] })
            message.success('大文件上传成功')
          }}
        />
      </Modal>

      {/* —— 文件预览 */}
      <FilePreview
        fileId={previewFileId}
        fileName={selectedFile?.original_name}
        mimeType={selectedFile?.mime_type}
        visible={previewVisible}
        onClose={() => { setPreviewVisible(false); setPreviewFileId(null) }}
      />
    </div>
  )
}
