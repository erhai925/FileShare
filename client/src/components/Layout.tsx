import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout as AntLayout, Menu, Avatar, Dropdown, message } from 'antd'
import {
  DashboardOutlined,
  FolderOutlined,
  TeamOutlined,
  SettingOutlined,
  UserOutlined,
  LogoutOutlined,
  DeleteOutlined
} from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'
import api from '../services/api'
import FileUpdateNotification from './FileUpdateNotification'
import './Layout.css'

const { Header, Sider, Content } = AntLayout

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const [notificationVisible, setNotificationVisible] = useState(false)

  // 获取最近一周的新文件（包括新上传和更新的）
  const { data: recentFiles } = useQuery({
    queryKey: ['files', 'recent-files'],
    queryFn: () => api.get('/files/recent-files'),
    enabled: !!user
  })

  // 检查是否需要显示通知（登录后只显示一次）
  useEffect(() => {
    console.log('通知检查 - user:', user);
    console.log('通知检查 - recentFiles:', recentFiles);
    
    if (!user) {
      console.log('通知检查 - 没有用户，退出');
      return;
    }
    
    if (!recentFiles?.data?.files) {
      console.log('通知检查 - 没有文件数据，退出');
      return;
    }

    const files = recentFiles.data.files
    console.log('通知检查 - 文件总数:', files.length);
    console.log('通知检查 - 文件列表:', files);
    
    if (files.length === 0) {
      console.log('通知检查 - 文件列表为空，退出');
      return;
    }

    // 过滤出团队成员上传/更新的文件（排除自己上传/更新的）
    const teamFiles = files.filter((f: any) => {
      const isTeamFile = f.created_by !== user.id && f.updated_by !== user.id;
      console.log(`通知检查 - 文件 ${f.id} (${f.original_name}): created_by=${f.created_by}, updated_by=${f.updated_by}, user.id=${user.id}, isTeamFile=${isTeamFile}`);
      return isTeamFile;
    })

    console.log('通知检查 - 团队成员文件数量:', teamFiles.length);

    if (teamFiles.length === 0) {
      console.log('通知检查 - 没有团队成员文件，退出');
      return;
    }

    // 检查是否已经显示过通知（使用 localStorage）
    const notificationKey = `file_update_notification_${user.id}_${new Date().toDateString()}`
    const hasShownToday = localStorage.getItem(notificationKey)
    
    console.log('通知检查 - localStorage key:', notificationKey);
    console.log('通知检查 - 今天已显示:', hasShownToday);

    if (!hasShownToday) {
      console.log('通知检查 - 显示通知弹框');
      setNotificationVisible(true)
      // 标记今天已显示
      localStorage.setItem(notificationKey, 'true')
    } else {
      console.log('通知检查 - 今天已显示过，不显示');
    }
  }, [user, recentFiles])

  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: '工作台'
    },
    {
      key: '/files',
      icon: <FolderOutlined />,
      label: '文件管理'
    },
    {
      key: '/spaces',
      icon: <TeamOutlined />,
      label: '空间管理'
    }
  ]

  if (user?.role === 'admin') {
    menuItems.push({
      key: '/admin',
      icon: <SettingOutlined />,
      label: '系统管理'
    })
  }

  // 回收站放在最下边
  menuItems.push({
    key: '/trash',
    icon: <DeleteOutlined />,
    label: '回收站'
  })

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人设置'
    },
    {
      type: 'divider' as const
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true
    }
  ]

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key)
  }

  const handleUserMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') {
      logout()
      message.success('已退出登录')
      navigate('/login')
    } else if (key === 'profile') {
      navigate('/profile')
    }
  }

  return (
    <AntLayout className="app-layout">
      <Header className="app-header">
        <div className="logo">FileShare</div>
        <div className="header-right">
          <Dropdown
            menu={{ items: userMenuItems, onClick: handleUserMenuClick }}
            placement="bottomRight"
          >
            <div className="user-info">
              <Avatar icon={<UserOutlined />} />
              <span className="username">{user?.realName || user?.username}</span>
            </div>
          </Dropdown>
        </div>
      </Header>
      <AntLayout>
        <Sider width={200} className="app-sider">
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={handleMenuClick}
          />
        </Sider>
        <Content className="app-content">
          <Outlet />
        </Content>
      </AntLayout>

      {/* 文件更新通知弹框 */}
      <FileUpdateNotification
        visible={notificationVisible}
        files={
          recentFiles?.data?.files?.filter((f: any) => 
            f.created_by !== user?.id && f.updated_by !== user?.id
          ) || []
        }
        onClose={() => setNotificationVisible(false)}
      />
    </AntLayout>
  )
}



