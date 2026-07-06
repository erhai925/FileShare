import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Card, Button, Input, message, Result, Spin, Typography, Space } from 'antd'
import {
  DownloadOutlined, FileOutlined, LockOutlined, MailOutlined
} from '@ant-design/icons'

const { Text, Title } = Typography

function fmtSize(bytes?: number) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

interface ShareInfo {
  resourceType: string
  resourceName: string | null
  resourceSize: number | null
  requirePassword: boolean
  requireEmail: boolean
  expired: boolean
}

// 公开分享落地页：外部用户无需登录即可打开，按需验证密码/邮箱后下载。
// 刻意使用原生 fetch，绕开全局 api 实例（不携带用户 token；密码错误的 401 不触发全局登出）。
export default function SharePage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const [loadError, setLoadError] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/shares/${token}`)
        const data = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok || !data.success) {
          setLoadError(data.message || '分享链接不存在')
        } else {
          setInfo(data.data)
        }
      } catch {
        if (alive) setLoadError('网络错误，无法加载分享信息')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [token])

  const handleDownload = async () => {
    if (info?.requirePassword && !password) { message.warning('请输入访问密码'); return }
    if (info?.requireEmail && !email) { message.warning('请输入授权邮箱'); return }
    setDownloading(true)
    try {
      const res = await fetch(`/api/shares/${token}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, email })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        message.error(data.message || '验证失败，无法下载')
        return
      }
      const accessToken = data.data.accessToken
      // 302 直链下载：attachment 响应不会导航离开当前页
      window.location.href = `/api/shares/${token}/download?token=${encodeURIComponent(accessToken)}`
    } catch {
      message.error('网络错误，下载失败')
    } finally {
      setDownloading(false)
    }
  }

  const centerWrap: React.CSSProperties = {
    minHeight: '100vh', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: '#f0f2f5', padding: 16
  }

  if (loading) {
    return <div style={centerWrap}><Spin size="large" /></div>
  }
  if (loadError) {
    return <div style={centerWrap}><Result status="404" title="无法访问" subTitle={loadError} /></div>
  }
  if (info?.expired) {
    return <div style={centerWrap}><Result status="warning" title="分享已过期" subTitle="该分享链接已超过有效期" /></div>
  }

  return (
    <div style={centerWrap}>
      <Card style={{ width: 420, maxWidth: '100%' }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <FileOutlined style={{ fontSize: 40, color: '#0d9488' }} />
            <Title level={4} style={{ marginTop: 12, marginBottom: 4, wordBreak: 'break-all' }}>
              {info?.resourceName || '分享文件'}
            </Title>
            {info?.resourceSize != null && <Text type="secondary">{fmtSize(info.resourceSize)}</Text>}
          </div>
          {info?.requirePassword && (
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="请输入访问密码"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onPressEnter={handleDownload}
            />
          )}
          {info?.requireEmail && (
            <Input
              prefix={<MailOutlined />}
              placeholder="请输入授权邮箱"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onPressEnter={handleDownload}
            />
          )}
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            block
            size="large"
            loading={downloading}
            onClick={handleDownload}
          >
            下载文件
          </Button>
        </Space>
      </Card>
    </div>
  )
}
