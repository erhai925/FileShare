import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Layout, Button, Space, Typography, Input, Select, Form, message,
  Modal, Spin, Tag, Breadcrumb, Card
} from 'antd'
import { SaveOutlined, SendOutlined, ArrowLeftOutlined, HomeOutlined, BookOutlined } from '@ant-design/icons'
import MDEditor from '@uiw/react-md-editor'
import { wikiApi } from '../../services/wikiService'
import ConflictDialog, { ConflictData } from '../../components/wiki/ConflictDialog'

const { Header, Content } = Layout
const { Text } = Typography

const DRAFT_KEY = (pid: number | string) => `wiki:draft:${pid}`
const AUTO_SAVE_INTERVAL = 30000 // 30 秒

export default function WikiPageEdit() {
  const { spaceId, pageId } = useParams<{ spaceId: string; pageId?: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const sid = Number(spaceId)
  const pid = pageId ? Number(pageId) : null
  const isNew = !pid
  const [form] = Form.useForm()
  const [content, setContent] = useState<string>('')
  const [tags, setTags] = useState<string[]>([])
  const [conflict, setConflict] = useState<ConflictData | null>(null)
  const [hasUnsaved, setHasUnsaved] = useState(false)
  const parentIdParam = params.get('parentId')

  // 加载页面（编辑模式）
  const { data: pageData, isLoading } = useQuery({
    queryKey: ['wiki', 'page-edit', pid],
    queryFn: () => wikiApi.getPage(pid!, true),
    enabled: !!pid
  })

  useEffect(() => {
    if (pageData?.data) {
      const p = pageData.data
      const localDraft = localStorage.getItem(DRAFT_KEY(p.id))
      // 优先用 localStorage 草稿（更新鲜），其次后端 draft_content，最后正式 content
      const initContent = localDraft || p.draft_content || p.content || ''
      form.setFieldsValue({ title: p.title })
      setContent(initContent)
      setTags((p.tags || []).map(t => t.name))
    }
  }, [pageData, form])

  // 自动保存到 localStorage
  useEffect(() => {
    if (!hasUnsaved) return
    const t = setInterval(() => {
      if (pid) localStorage.setItem(DRAFT_KEY(pid), content)
    }, AUTO_SAVE_INTERVAL)
    return () => clearInterval(t)
  }, [content, pid, hasUnsaved])

  // 离开页面前提示
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsaved) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsaved])

  const createMut = useMutation({
    mutationFn: (data: any) => wikiApi.createPage(data),
    onSuccess: (r) => {
      message.success('页面已创建')
      setHasUnsaved(false)
      qc.invalidateQueries({ queryKey: ['wiki'] })
      navigate(`/wiki/spaces/${sid}/p/${r.data.pageId}`)
    },
    onError: (e: any) => message.error(e?.message || '创建失败')
  })

  const saveDraftMut = useMutation({
    mutationFn: () => wikiApi.saveDraft(pid!, { title: form.getFieldValue('title'), content }),
    onSuccess: () => {
      message.success('草稿已保存')
      setHasUnsaved(false)
      if (pid) localStorage.removeItem(DRAFT_KEY(pid))
    },
    onError: (e: any) => message.error(e?.message || '保存失败')
  })

  const updateMut = useMutation({
    mutationFn: (changeNote?: string) => wikiApi.updatePage(pid!, {
      title: form.getFieldValue('title'),
      content,
      tags,
      expectedVersion: pageData!.data.version,
      changeNote
    }),
    onSuccess: () => {
      message.success('已发布新版本')
      setHasUnsaved(false)
      if (pid) localStorage.removeItem(DRAFT_KEY(pid))
      qc.invalidateQueries({ queryKey: ['wiki'] })
      navigate(`/wiki/spaces/${sid}/p/${pid}`)
    },
    onError: (e: any) => {
      if (e?.conflict && e?.data) {
        setConflict(e.data as ConflictData)
      } else {
        message.error(e?.message || '保存失败')
      }
    }
  })

  const handlePublish = () => {
    form.validateFields().then(() => {
      Modal.confirm({
        title: '发布新版本',
        content: (
          <div>
            <p>每次发布将生成新版本，可在历史中回滚。</p>
            <Input.TextArea
              id="change-note-input"
              placeholder="变更说明（可选）"
              rows={2}
            />
          </div>
        ),
        onOk: () => {
          const noteEl = document.getElementById('change-note-input') as HTMLTextAreaElement
          updateMut.mutate(noteEl?.value || undefined)
        }
      })
    })
  }

  const handleCreate = (status: 'draft' | 'published') => {
    form.validateFields().then((vals) => {
      createMut.mutate({
        spaceId: sid,
        parentId: parentIdParam ? Number(parentIdParam) : null,
        title: vals.title,
        content,
        template: vals.template,
        tags,
        status
      })
    })
  }

  if (pid && isLoading) return <Spin />

  return (
    <Layout style={{ height: 'calc(100vh - 56px)', background: '#fff' }}>
      <Header style={{ background: '#fff', padding: '0 24px', borderBottom: '1px solid #f0f0f0', height: 'auto', lineHeight: 'normal' }}>
        <div style={{ paddingTop: 12, paddingBottom: 12 }}>
          <Breadcrumb
            items={[
              { title: <a onClick={() => navigate('/wiki')}><HomeOutlined /> Wiki</a> },
              { title: <a onClick={() => navigate(`/wiki/spaces/${sid}`)}><BookOutlined /> 知识库</a> },
              { title: isNew ? '新建页面' : (pageData?.data.title || '编辑') }
            ]}
            style={{ marginBottom: 8 }}
          />
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Form form={form} layout="inline" initialValues={{ template: 'blank' }}>
              <Form.Item
                name="title"
                rules={[{ required: true, message: '请输入标题' }]}
                style={{ marginBottom: 0, minWidth: 320 }}
              >
                <Input placeholder="页面标题" size="large" bordered={false} style={{ fontSize: 18, fontWeight: 600 }} />
              </Form.Item>
              {isNew && (
                <Form.Item name="template" style={{ marginBottom: 0 }}>
                  <Select
                    style={{ width: 180 }}
                    options={[
                      { value: 'blank', label: '空白页' },
                      { value: 'qa', label: '问题-解决（FAQ）' }
                    ]}
                  />
                </Form.Item>
              )}
            </Form>
            <Space>
              <Button icon={<ArrowLeftOutlined />} onClick={() => {
                if (hasUnsaved) {
                  Modal.confirm({
                    title: '有未保存的修改，确定离开？',
                    onOk: () => navigate(-1)
                  })
                } else navigate(-1)
              }}>取消</Button>
              {!isNew && (
                <Button icon={<SaveOutlined />} onClick={() => saveDraftMut.mutate()} loading={saveDraftMut.isPending}>
                  保存草稿
                </Button>
              )}
              {isNew ? (
                <>
                  <Button onClick={() => handleCreate('draft')} loading={createMut.isPending}>
                    保存为草稿
                  </Button>
                  <Button type="primary" icon={<SendOutlined />} onClick={() => handleCreate('published')} loading={createMut.isPending}>
                    发布
                  </Button>
                </>
              ) : (
                <Button type="primary" icon={<SendOutlined />} onClick={handlePublish} loading={updateMut.isPending}>
                  发布新版本
                </Button>
              )}
            </Space>
          </Space>
        </div>
      </Header>

      <Content style={{ padding: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Card size="small" style={{ marginBottom: 8 }}>
          <Space>
            <Text>标签:</Text>
            <Select
              mode="tags"
              style={{ minWidth: 300 }}
              placeholder="输入标签后回车"
              value={tags}
              onChange={(v) => { setTags(v); setHasUnsaved(true) }}
              tokenSeparators={[',', ' ']}
            />
            {hasUnsaved && <Tag color="orange">未保存</Tag>}
          </Space>
        </Card>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <MDEditor
            value={content}
            onChange={(v) => { setContent(v || ''); setHasUnsaved(true) }}
            height="100%"
            preview="live"
            visibleDragbar={false}
          />
        </div>
      </Content>

      <ConflictDialog
        open={!!conflict}
        data={conflict}
        onCancel={() => setConflict(null)}
        onOverwrite={() => {
          // 强制覆盖：用本地内容 + 服务端最新版本号写入新版
          if (!conflict || !pid) return
          wikiApi.updatePage(pid, {
            title: form.getFieldValue('title'),
            content,
            tags,
            expectedVersion: conflict.currentVersion,
            changeNote: '冲突覆盖：保留本地修改'
          }).then(() => {
            message.success('已强制覆盖并发布新版本')
            setConflict(null); setHasUnsaved(false)
            if (pid) localStorage.removeItem(DRAFT_KEY(pid))
            navigate(`/wiki/spaces/${sid}/p/${pid}`)
          }).catch((e: any) => {
            message.error(e?.message || '覆盖失败')
          })
        }}
        onDiscard={() => {
          if (!conflict) return
          form.setFieldsValue({ title: conflict.currentTitle })
          setContent(conflict.currentContent)
          setConflict(null)
          setHasUnsaved(false)
          message.info('已载入服务器最新版本，请重新编辑')
        }}
      />
    </Layout>
  )
}
