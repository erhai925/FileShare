import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, message, Tooltip } from 'antd'
import { BellOutlined, BellFilled } from '@ant-design/icons'
import { wikiApi } from '../../services/wikiService'

interface Props {
  targetType: 'page' | 'space' | 'tag'
  targetId: number
  size?: 'small' | 'middle' | 'large'
  /** 是否仅显示图标按钮（页面顶栏使用） */
  iconOnly?: boolean
}

/**
 * 订阅切换按钮：自动检测当前用户是否已订阅，点击切换。
 * 注意：订阅列表 API 是 listSubscriptions（用户级），所以这里查全列表后过滤当前 target。
 */
export default function SubscribeButton({ targetType, targetId, size = 'small', iconOnly }: Props) {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['wiki', 'subscriptions'],
    queryFn: () => wikiApi.listSubscriptions()
  })
  const subscribed = (data?.data || []).find(
    (s: any) => s.target_type === targetType && s.target_id === targetId
  )

  const subscribe = useMutation({
    mutationFn: () => wikiApi.subscribe(targetType, targetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki', 'subscriptions'] })
      message.success('已订阅，更新时会通知你')
    },
    onError: (e: any) => message.error(e?.message || '订阅失败')
  })
  const unsubscribe = useMutation({
    mutationFn: () => wikiApi.unsubscribe(subscribed.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki', 'subscriptions'] })
      message.success('已取消订阅')
    },
    onError: (e: any) => message.error(e?.message || '取消订阅失败')
  })

  const label = subscribed ? '已订阅' : '订阅'
  const icon = subscribed
    ? <BellFilled style={{ color: '#0d9488' }} />
    : <BellOutlined />

  return (
    <Tooltip title={subscribed ? '点击取消订阅' : '订阅更新'}>
      <Button
        size={size}
        icon={icon}
        loading={subscribe.isPending || unsubscribe.isPending}
        onClick={() => subscribed ? unsubscribe.mutate() : subscribe.mutate()}
      >
        {!iconOnly && label}
      </Button>
    </Tooltip>
  )
}
