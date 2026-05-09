import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Layout, Button, Space, Typography, Empty, Spin, Breadcrumb, message, Modal,
  Switch, Upload, Alert
} from 'antd'
import {
  PlusOutlined, BookOutlined, HomeOutlined, DeleteOutlined, ArrowLeftOutlined,
  DownloadOutlined, UploadOutlined, CheckSquareOutlined, FilePdfOutlined
} from '@ant-design/icons'
import { Dropdown, Progress } from 'antd'
import api from '../../services/api'
import { wikiApi } from '../../services/wikiService'
import PageTree from '../../components/wiki/PageTree'
import BatchActionBar from '../../components/wiki/BatchActionBar'
import SubscribeButton from '../../components/wiki/SubscribeButton'

const { Sider, Content } = Layout
const { Title, Text } = Typography

export default function WikiSpace() {
  const { spaceId } = useParams<{ spaceId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const sid = Number(spaceId)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [includeDraft, setIncludeDraft] = useState(true)
  const [batchMode, setBatchMode] = useState(false)
  const [checkedIds, setCheckedIds] = useState<number[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)
  const [pdfTaskId, setPdfTaskId] = useState<string | null>(null)
  const [pdfTaskState, setPdfTaskState] = useState<any>(null)

  const { data: spaceData } = useQuery({
    queryKey: ['wiki', 'space', sid],
    queryFn: () => wikiApi.getSpace(sid),
    enabled: !!sid
  })
  const { data: treeData, isLoading: treeLoading } = useQuery({
    queryKey: ['wiki', 'tree', sid, includeArchived, includeDraft],
    queryFn: () => wikiApi.getTree(sid, { includeArchived, includeDraft }),
    enabled: !!sid
  })

  const movePage = useMutation({
    mutationFn: ({ id, parentId }: { id: number; parentId: number | null }) =>
      wikiApi.movePage(id, { parentId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki', 'tree', sid] })
  })

  const deleteSpace = useMutation({
    mutationFn: () => wikiApi.deleteSpace(sid),
    onSuccess: () => {
      message.success('知识库已删除')
      navigate('/wiki')
    },
    onError: (e: any) => message.error(e?.message || '删除失败')
  })

  // 整库 PDF 异步导出
  const startPdfExport = async () => {
    try {
      const r: any = await wikiApi.exportSpacePdf(sid)
      const taskId = r?.data?.taskId
      if (!taskId) throw new Error('未拿到任务 ID')
      setPdfTaskId(taskId)
      setPdfTaskState({ status: 'pending' })
      message.info('PDF 导出任务已开始，请稍候')
    } catch (e: any) {
      message.error(e?.message || '创建导出任务失败')
    }
  }

  // 任务进度轮询（每 1.5s 一次，状态进入 done/failed 后自动停止）
  useEffect(() => {
    if (!pdfTaskId || (pdfTaskState && (pdfTaskState.status === 'done' || pdfTaskState.status === 'failed'))) {
      return
    }
    const t = setInterval(async () => {
      try {
        const r: any = await wikiApi.exportTaskStatus(pdfTaskId)
        setPdfTaskState(r.data)
        if (r.data.status === 'done') {
          message.success('PDF 已生成')
          // 自动触发下载
          window.open(wikiApi.exportTaskDownloadUrl(pdfTaskId), '_blank')
        } else if (r.data.status === 'failed') {
          message.error(`导出失败：${r.data.error || ''}`)
        }
      } catch (e) { /* ignore */ }
    }, 1500)
    return () => clearInterval(t)
  }, [pdfTaskId, pdfTaskState?.status])

  const handleImport = async (file: File, overwrite: boolean) => {
    setImporting(true)
    setImportResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('overwrite', overwrite ? '1' : '0')
      const r: any = await api.post(`/wiki/spaces/${sid}/import`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 5 * 60 * 1000
      })
      setImportResult(r.data)
      message.success(r.message || '导入完成')
      qc.invalidateQueries({ queryKey: ['wiki', 'tree', sid] })
    } catch (e: any) {
      message.error(e?.message || '导入失败')
    } finally {
      setImporting(false)
    }
    return false // 阻止 antd 默认上传
  }

  const space = spaceData?.data
  const pages = treeData?.data || []

  return (
    <Layout style={{ height: 'calc(100vh - 56px)', background: '#fff' }}>
      <Sider width={300} theme="light" style={{ borderRight: '1px solid #f0f0f0', overflow: 'auto' }}>
        <div style={{ padding: 12 }}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Button icon={<ArrowLeftOutlined />} type="link" onClick={() => navigate('/wiki')} style={{ paddingLeft: 0 }}>
              返回知识库列表
            </Button>
            <Title level={5} style={{ margin: 0 }}>
              <BookOutlined /> {space?.name || '加载中...'}
            </Title>
            {space?.description && <Text type="secondary" style={{ fontSize: 12 }}>{space.description}</Text>}
            <Space.Compact block>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                style={{ flex: 1 }}
                onClick={() => navigate(`/wiki/spaces/${sid}/new`)}
              >
                新建页面
              </Button>
              <Button
                icon={<UploadOutlined />}
                onClick={() => { setImportResult(null); setImportOpen(true) }}
                title="批量导入"
              />
            </Space.Compact>
            <Space size={8} style={{ marginTop: 4 }}>
              <Space size={4}>
                <Switch size="small" checked={includeArchived} onChange={setIncludeArchived} />
                <Text style={{ fontSize: 12 }}>归档</Text>
              </Space>
              <Space size={4}>
                <Switch size="small" checked={includeDraft} onChange={setIncludeDraft} />
                <Text style={{ fontSize: 12 }}>草稿</Text>
              </Space>
              <Space size={4}>
                <Switch size="small" checked={batchMode} onChange={(v) => { setBatchMode(v); if (!v) setCheckedIds([]) }} />
                <Text style={{ fontSize: 12 }}>多选</Text>
              </Space>
            </Space>
          </Space>
        </div>
        <div style={{ padding: '0 8px 12px' }}>
          <PageTree
            pages={pages}
            loading={treeLoading}
            checkable={batchMode}
            checkedKeys={checkedIds}
            onCheckChange={setCheckedIds}
            onSelect={(p) => !batchMode && navigate(`/wiki/spaces/${sid}/p/${p.id}`)}
            onDrop={({ dragId, dropId, dropToGap }) => {
              const newParentId = dropToGap
                ? (pages.find(p => p.id === dropId)?.parent_id ?? null)
                : dropId
              movePage.mutate({ id: dragId, parentId: newParentId })
            }}
          />
        </div>
      </Sider>

      <Content style={{ padding: 24, overflow: 'auto' }}>
        <Breadcrumb
          items={[
            { title: <a onClick={() => navigate('/wiki')}><HomeOutlined /> Wiki</a> },
            { title: space?.name }
          ]}
          style={{ marginBottom: 16 }}
        />
        {space ? (
          <div>
            <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }}>
              <div>
                <Title level={3} style={{ margin: 0 }}>{space.name}</Title>
                {space.description && <Text type="secondary">{space.description}</Text>}
              </div>
              <Space>
                <SubscribeButton targetType="space" targetId={sid} size="middle" />
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'zip',
                        icon: <DownloadOutlined />,
                        label: <a href={wikiApi.exportSpaceUrl(sid)} target="_blank" rel="noreferrer">导出 zip（Markdown）</a>
                      },
                      {
                        key: 'pdf',
                        icon: <FilePdfOutlined />,
                        label: '导出 PDF（异步）',
                        onClick: startPdfExport
                      }
                    ]
                  }}
                >
                  <Button icon={<DownloadOutlined />}>导出</Button>
                </Dropdown>
                <Button
                  icon={<CheckSquareOutlined />}
                  type={batchMode ? 'primary' : 'default'}
                  onClick={() => setBatchMode(v => !v)}
                >
                  {batchMode ? '退出多选' : '多选'}
                </Button>
                <Button danger icon={<DeleteOutlined />} onClick={() => {
                  Modal.confirm({
                    title: '删除知识库',
                    content: '只有清空所有页面的知识库才能删除。是否继续？',
                    onOk: () => deleteSpace.mutate()
                  })
                }}>
                  删除
                </Button>
              </Space>
            </Space>
            <Empty
              description={
                pages.length === 0
                  ? '知识库为空，新建第一篇页面或上传 .md / .zip 开始'
                  : '请从左侧目录选择页面'
              }
            />
          </div>
        ) : <Spin />}
      </Content>

      {/* 批量操作浮动栏 */}
      <BatchActionBar
        selectedIds={checkedIds}
        spaceId={sid}
        onClear={() => { setCheckedIds([]); setBatchMode(false) }}
      />

      {/* PDF 异步导出进度浮动条 */}
      {pdfTaskId && pdfTaskState && pdfTaskState.status !== 'done' && pdfTaskState.status !== 'failed' && (
        <div style={{
          position: 'fixed', right: 24, bottom: 24, zIndex: 999,
          background: '#fff', border: '1px solid #d9d9d9', borderRadius: 8,
          padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', width: 280
        }}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Space style={{ justifyContent: 'space-between', width: '100%' }}>
              <Text strong><FilePdfOutlined /> 整库 PDF 导出</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {pdfTaskState.status === 'pending' && '排队中...'}
                {pdfTaskState.status === 'running' && (pdfTaskState.progress?.phase === 'pdf' ? '生成 PDF 中' : '渲染中')}
              </Text>
            </Space>
            <Progress percent={pdfTaskState.status === 'running' ? 60 : 20} status="active" showInfo={false} />
            <Button size="small" type="link" onClick={() => { setPdfTaskId(null); setPdfTaskState(null) }} style={{ paddingLeft: 0 }}>
              关闭
            </Button>
          </Space>
        </div>
      )}

      {/* 导入 Modal */}
      <Modal
        title="批量导入 Markdown"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        footer={null}
        width={560}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="支持 .zip（含目录结构）或单个 .md 文件"
          description={
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              <li>解析 YAML front-matter（title / tags / status）还原元数据</li>
              <li>按 zip 内目录结构重建页面父子关系</li>
              <li>建议使用 UTF-8 编码的 zip（macOS 命令行 zip 中文目录可能乱码）</li>
            </ul>
          }
        />
        <Upload.Dragger
          name="file"
          multiple={false}
          accept=".zip,.md"
          beforeUpload={(file) => handleImport(file, false)}
          showUploadList={false}
          disabled={importing}
        >
          <p className="ant-upload-drag-icon"><UploadOutlined /></p>
          <p className="ant-upload-text">{importing ? '导入中...' : '点击或拖拽文件到此区域'}</p>
          <p className="ant-upload-hint">.md 单文件 / .zip 批量（含目录树）</p>
        </Upload.Dragger>

        {importResult && (
          <Alert
            style={{ marginTop: 12 }}
            type={importResult.failedCount > 0 ? 'warning' : 'success'}
            message={`导入完成：成功 ${importResult.createdCount}，失败 ${importResult.failedCount}`}
            description={
              importResult.failed?.length > 0 && (
                <details>
                  <summary>失败明细</summary>
                  <ul>
                    {importResult.failed.map((f: any, i: number) => (
                      <li key={i}>{f.path}: {f.error}</li>
                    ))}
                  </ul>
                </details>
              )
            }
          />
        )}
      </Modal>
    </Layout>
  )
}
