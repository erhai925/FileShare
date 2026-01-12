import { Card, Form, Input, Button, message } from 'antd'
import { useAuthStore } from '../stores/authStore'
import { authService } from '../services/authService'

export default function Profile() {
  const { user } = useAuthStore()
  const [form] = Form.useForm()

  const onFinish = async (values: { oldPassword: string; newPassword: string }) => {
    try {
      await authService.changePassword(values.oldPassword, values.newPassword)
      message.success('密码修改成功')
      form.resetFields()
    } catch (error: any) {
      message.error(error.message || '密码修改失败')
    }
  }

  return (
    <div>
      <Card title="个人设置" style={{ maxWidth: 600 }}>
        <div style={{ marginBottom: 24 }}>
          <p><strong>用户名:</strong> {user?.username}</p>
          <p><strong>邮箱:</strong> {user?.email}</p>
          <p><strong>角色:</strong> {user?.role}</p>
        </div>

        <Card title="修改密码" type="inner">
          <Form
            form={form}
            onFinish={onFinish}
            layout="vertical"
          >
            <Form.Item
              name="oldPassword"
              label="旧密码"
              rules={[{ required: true, message: '请输入旧密码' }]}
            >
              <Input.Password />
            </Form.Item>

            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 6, message: '密码长度至少6位' }
              ]}
            >
              <Input.Password />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请确认新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) {
                      return Promise.resolve()
                    }
                    return Promise.reject(new Error('两次输入的密码不一致'))
                  }
                })
              ]}
            >
              <Input.Password />
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit">
                修改密码
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Card>
    </div>
  )
}





