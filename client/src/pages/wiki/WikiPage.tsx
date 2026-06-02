import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Layout, Button, Space, Typography, Spin, Breadcrumb, Tag, message, Modal,
  Card, Avatar, List, Input, Empty, Dropdown, Tooltip, Image
} from 'antd'
import {
  HomeOutlined, EditOutlined, DeleteOutlined, StarOutlined,
  StarFilled, HistoryOutlined, DownloadOutlined, MoreOutlined, FileTextOutlined,
  CommentOutlined, UserOutlined, ArrowLeftOutlined, InboxOutlined,
  RollbackOutlined
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { wikiApi } from '../../services/wikiService'
import PageTree from '../../components/wiki/PageTree'
import TocPanel from '../../components/wiki/TocPanel'
import VersionDrawer from '../../components/wiki/VersionDrawer'
import AttachmentPanel from '../../components/wiki/AttachmentPanel'
import SubscribeButton from '../../components/wiki/SubscribeButton'
import PermissionDialog from '../../components/wiki/PermissionDialog'
import { useAuthStore } from '../../stores/authStore'

const { Sider, Content } = Layout
const { Title, Text, Paragraph } = Typography

export default function WikiPage() {
  const { spaceId, pageId } = useParams<{ spaceId: string; pageId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const sid = Number(spaceId)
  const pid = Number(pageId)
  const [versionOpen, setVersionOpen] = useState(false)
  const [permsOpen, setPermsOpen] = useState(false)
  const [commentText, setCommentText] = useState('')
  const { user: currentUser } = useAuthStore()

  const { data: spaceData } = useQuery({
    queryKey: ['wiki', 'space', sid],
    queryFn: () => wikiApi.getSpace(sid),
    enabled: !!sid
  })
  const { data: treeData } = useQuery({
    queryKey: ['wiki', 'tree', sid],
    queryFn: () => wikiApi.getTree(sid, { includeDraft: true }),
    enabled: !!sid
  })
  const { data: pageData, isLoading } = useQuery({
    queryKey: ['wiki', 'page', pid],
    queryFn: () => wikiApi.getPage(pid),
    enabled: !!pid
  })
  const { data: commentsData } = useQuery({
    queryKey: ['wiki', 'comments', pid],
    queryFn: () => wikiApi.listComments(pid),
    enabled: !!pid
  })
  const { data: contributorsData } = useQuery({
    queryKey: ['wiki', 'contributors', pid],
    queryFn: () => wikiApi.pageContributors(pid),
    enabled: !!pid
  })

  // 浏览统计（去抖在后端，5 分钟内不重复计数）
  useEffect(() => {
    if (pid) wikiApi.recordView(pid).catch(() => {})
  }, [pid])

  const toggleFav = useMutation({
    mutationFn: () => wikiApi.toggleFavorite(pid),
    onSuccess: (r: any) => {
      message.success(r.data.favorited ? '已收藏' : '已取消收藏')
      qc.invalidateQueries({ queryKey: ['wiki', 'page', pid] })
      qc.invalidateQueries({ queryKey: ['wiki', 'favorites'] })
    }
  })
  const deletePage = useMutation({
    mutationFn: () => wikiApi.deletePage(pid),
    onSuccess: () => {
      message.success('已移到回收站')
      qc.invalidateQueries({ queryKey: ['wiki', 'tree', sid] })
      navigate(`/wiki/spaces/${sid}`)
    },
    onError: (e: any) => message.error(e?.message || '删除失败')
  })
  const archive = useMutation({
    mutationFn: () => wikiApi.archivePage(pid),
    onSuccess: () => {
      message.success('已归档')
      qc.invalidateQueries({ queryKey: ['wiki'] })
    }
  })
  const unarchive = useMutation({
    mutationFn: () => wikiApi.unarchivePage(pid),
    onSuccess: () => {
      message.success('已取消归档')
      qc.invalidateQueries({ queryKey: ['wiki'] })
    }
  })
  const addComment = useMutation({
    mutationFn: (content: string) => wikiApi.addComment(pid, { content }),
    onSuccess: () => {
      setCommentText('')
      qc.invalidateQueries({ queryKey: ['wiki', 'comments', pid] })
      message.success('评论已发表')
    },
    onError: (e: any) => message.error(e?.message || '评论失败')
  })

  const page = pageData?.data
  const space = spaceData?.data
  const pages = treeData?.data || []
  const canWrite = !!page?.permissions?.write
  const canDelete = !!page?.permissions?.delete
  const canComment = !!page?.permissions?.comment

  if (isLoading) return <Spin />
  if (!page) return <Empty description="页面不存在或无权限访问" />

  return (
    <Layout style={{ height: 'calc(100vh - 56px)', background: '#fff' }}>
      <Sider width={260} theme="light" style={{ borderRight: '1px solid #f0f0f0', overflow: 'auto' }}>
        <div style={{ padding: 12 }}>
          <Button icon={<ArrowLeftOutlined />} type="link" onClick={() => navigate(`/wiki/spaces/${sid}`)} style={{ paddingLeft: 0 }}>
            {space?.name || '返回'}
          </Button>
        </div>
        <div style={{ padding: '0 8px 12px' }}>
          <PageTree
            pages={pages}
            selectedKey={pid}
            onSelect={(p) => navigate(`/wiki/spaces/${sid}/p/${p.id}`)}
          />
        </div>
      </Sider>

      <Content style={{ padding: 24, overflow: 'auto' }}>
        <Breadcrumb
          items={[
            { title: <a onClick={() => navigate('/wiki')}><HomeOutlined /> Wiki</a> },
            { title: <a onClick={() => navigate(`/wiki/spaces/${sid}`)}>{space?.name}</a> },
            { title: page.title }
          ]}
          style={{ marginBottom: 16 }}
        />

        <Layout style={{ background: '#fff' }}>
          <Content>
            <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Title level={2} style={{ margin: 0 }}>
                  <FileTextOutlined style={{ color: '#0d9488', marginRight: 8 }} />
                  {page.title}
                  {page.status === 'draft' && <Tag color="orange" style={{ marginLeft: 8 }}>草稿</Tag>}
                  {page.archived_at && <Tag color="default" style={{ marginLeft: 8 }}>已归档</Tag>}
                </Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  v{page.version} · 更新于 {new Date(page.updated_at).toLocaleString('zh-CN')}
                  · 浏览 {page.view_count}
                </Text>
              </div>
              <Space>
                <Tooltip title={page.is_favorited ? '取消收藏' : '收藏'}>
                  <Button
                    icon={page.is_favorited
                      ? <StarFilled style={{ color: '#faad14' }} />
                      : <StarOutlined />}
                    onClick={() => toggleFav.mutate()}
                  />
                </Tooltip>
                <SubscribeButton targetType="page" targetId={pid} size="middle" iconOnly />
                <Button icon={<HistoryOutlined />} onClick={() => setVersionOpen(true)}>
                  历史
                </Button>
                {canWrite && (
                  <Button
                    type="primary"
                    icon={<EditOutlined />}
                    onClick={() => navigate(`/wiki/spaces/${sid}/p/${pid}/edit`)}
                  >
                    编辑
                  </Button>
                )}
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'export-md',
                        label: <a href={wikiApi.exportPageUrl(pid, 'md')} target="_blank" rel="noreferrer">
                          <DownloadOutlined /> 导出 Markdown
                        </a>
                      },
                      {
                        key: 'export-pdf',
                        label: <a href={wikiApi.exportPageUrl(pid, 'pdf')} target="_blank" rel="noreferrer">
                          <DownloadOutlined /> 导出 PDF（需服务端 puppeteer）
                        </a>
                      },
                      ...(currentUser?.role === 'admin' ? [{
                        key: 'perms',
                        icon: <UserOutlined />,
                        label: '页面权限',
                        onClick: () => setPermsOpen(true)
                      }] : []),
                      ...(canWrite ? [{
                        key: page.archived_at ? 'unarchive' : 'archive',
                        icon: page.archived_at ? <RollbackOutlined /> : <InboxOutlined />,
                        label: page.archived_at ? '取消归档' : '归档',
                        onClick: () => page.archived_at ? unarchive.mutate() : archive.mutate()
                      }] : []),
                      ...(canDelete ? [{
                        key: 'delete',
                        icon: <DeleteOutlined />,
                        label: '删除',
                        danger: true,
                        onClick: () => Modal.confirm({
                          title: '删除页面？',
                          content: '页面将进入回收站，30 天后自动彻底删除。子页面会一起删除。',
                          onOk: () => deletePage.mutate()
                        })
                      }] : [])
                    ] as any
                  }}
                >
                  <Button icon={<MoreOutlined />} />
                </Dropdown>
              </Space>
            </Space>

            {(page.tags || []).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {page.tags!.map(t => (
                  <Tag key={t.id} color={t.color}>{t.name}</Tag>
                ))}
              </div>
            )}

            <div className="markdown-body" style={{ lineHeight: 1.8, fontSize: 15 }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // 图片：点击放大查看全貌（遮罩层），点击图片外/ESC 关闭恢复
                  img: ({ src, alt }) => (
                    <Image
                      src={typeof src === 'string' ? src : ''}
                      alt={alt}
                      style={{ maxWidth: '100%', cursor: 'zoom-in', borderRadius: 4 }}
                      preview={{ mask: '点击查看大图' }}
                    />
                  ),
                  h1: ({ children, ...p }) => {
                    const id = encodeURIComponent(String(children).toLowerCase().replace(/[\s\/\\?#&=+%]+/g, '-'))
                    return <h1 id={id} {...p}>{children}</h1>
                  },
                  h2: ({ children, ...p }) => {
                    const id = encodeURIComponent(String(children).toLowerCase().replace(/[\s\/\\?#&=+%]+/g, '-'))
                    return <h2 id={id} {...p}>{children}</h2>
                  },
                  h3: ({ children, ...p }) => {
                    const id = encodeURIComponent(String(children).toLowerCase().replace(/[\s\/\\?#&=+%]+/g, '-'))
                    return <h3 id={id} {...p}>{children}</h3>
                  },
                  // 渲染 [[Page]] 内链
                  p: ({ children, ...rest }) => {
                    const arr = Array.isArray(children) ? children : [children]
                    const out: any[] = []
                    arr.forEach((c, i) => {
                      if (typeof c === 'string') {
                        const re = /\[\[([^\]]+)\]\]/g
                        let last = 0; let m
                        while ((m = re.exec(c)) !== null) {
                          if (m.index > last) out.push(c.slice(last, m.index))
                          out.push(
                            <a
                              key={`wl-${i}-${m.index}`}
                              style={{ color: '#0d9488', borderBottom: '1px dashed #0d9488' }}
                              onClick={(e) => {
                                e.preventDefault()
                                // 在树中找匹配标题的页面跳转
                                const target = pages.find(p => p.title === m![1] || p.slug === m![1])
                                if (target) navigate(`/wiki/spaces/${sid}/p/${target.id}`)
                                else message.warning('未找到匹配页面')
                              }}
                            >{m[1]}</a>
                          )
                          last = m.index + m[0].length
                        }
                        if (last < c.length) out.push(c.slice(last))
                      } else {
                        out.push(c)
                      }
                    })
                    return <p {...rest}>{out}</p>
                  }
                }}
              >
                {page.content || ''}
              </ReactMarkdown>
            </div>

            {/* 反向链接 */}
            {(page.backlinks || []).length > 0 && (
              <Card title="被引用于" size="small" style={{ marginTop: 24 }}>
                <List
                  size="small"
                  dataSource={page.backlinks}
                  renderItem={(b: any) => (
                    <List.Item>
                      <a onClick={() => navigate(`/wiki/spaces/${sid}/p/${b.id}`)}>{b.title}</a>
                    </List.Item>
                  )}
                />
              </Card>
            )}

            {/* 评论 */}
            <Card title={<><CommentOutlined /> 评论 ({commentsData?.data?.length || 0})</>} size="small" style={{ marginTop: 24 }}>
              {canComment ? (
                <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
                  <Input.TextArea
                    rows={2}
                    placeholder="写下你的评论或补充经验..."
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                  />
                  <Button
                    type="primary"
                    onClick={() => commentText.trim() && addComment.mutate(commentText.trim())}
                    loading={addComment.isPending}
                  >发表</Button>
                </Space.Compact>
              ) : (
                <Text type="secondary">无评论权限</Text>
              )}
              <List
                dataSource={commentsData?.data || []}
                renderItem={(c: any) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={<Avatar icon={<UserOutlined />} />}
                      title={
                        <Space>
                          <span>{c.real_name || c.username}</span>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {new Date(c.created_at).toLocaleString('zh-CN')}
                          </Text>
                        </Space>
                      }
                      description={<Paragraph style={{ marginBottom: 0 }}>{c.content}</Paragraph>}
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Content>

          <Sider width={240} theme="light" style={{ background: '#fff', paddingLeft: 16, marginLeft: 16, borderLeft: '1px solid #f0f0f0' }}>
            <Card size="small" title="目录大纲" style={{ marginBottom: 12 }}>
              <TocPanel markdown={page.content} />
            </Card>
            <Card size="small" style={{ marginBottom: 12 }}>
              <AttachmentPanel pageId={pid} canWrite={canWrite} />
            </Card>
            <Card size="small" title="贡献者">
              {(contributorsData?.data || []).length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无" />
              ) : (
                <Space wrap>
                  {(contributorsData?.data || []).map((u: any) => (
                    <Tooltip
                      key={u.id}
                      title={`${u.real_name || u.username} · ${u.edit_count} 次编辑`}
                    >
                      <Avatar size="small" icon={<UserOutlined />}>{(u.real_name || u.username || '?')[0]}</Avatar>
                    </Tooltip>
                  ))}
                </Space>
              )}
            </Card>
          </Sider>
        </Layout>
      </Content>

      <VersionDrawer
        pageId={pid}
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        canRollback={canWrite}
      />

      <PermissionDialog
        open={permsOpen}
        pageId={pid}
        pageTitle={page.title}
        onClose={() => setPermsOpen(false)}
      />
    </Layout>
  )
}
