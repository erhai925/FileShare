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
import { useAuthStore } from '../stores/authStore'
import './Layout.css'

const { Header, Sider, Content } = AntLayout

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()

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
    </AntLayout>
  )
}



