# 企业微信消息转智能表格

将企业微信群机器人消息自动转发到企业微信智能表格。

## 功能

- 接收企业微信群机器人的Webhook消息
- 解析消息内容、发送者信息
- 自动写入企业微信智能表格
- 支持测试接口

## 字段映射

| 表格列 | 字段ID | 数据来源 |
|--------|--------|----------|
| 文本列 | f04Gwj | 消息内容 |
| 单选框列 | ftQMc5 | 固定值"群消息" |
| 人员列 | ftk5Tx | 发送者user_id（可选） |
| 数字列 | ffFwIh | 消息长度 |
| 日期列 | fn8TJd | 当前时间戳 |

## 部署到Render

### 1. 创建Git仓库
```bash
git init
git add .
git commit -m "初始提交"
git remote add origin <你的Git仓库地址>
git push -u origin main
```

### 2. 在Render创建Web Service
1. 登录 https://render.com
2. 点击"New +" → "Web Service"
3. 连接你的Git仓库
4. 配置环境变量（见下文）

### 3. 环境变量
在Render Dashboard设置：

```
SHEET_WEBHOOK_URL = "你的智能表格Webhook地址"
```

### 4. 获取服务地址
部署完成后，Render会提供一个URL，如：
```
https://your-app.onrender.com
```

## 配置企业微信群机器人

1. 在企业微信群里添加"群机器人"
2. 获取机器人的Webhook地址
3. 配置发送到：`https://你的应用.onrender.com/webhook/wecom`

## API接口

### 1. 接收企业微信消息
```
POST /webhook/wecom
Content-Type: application/json

{
  "msgtype": "text",
  "text": {
    "content": "消息内容"
  },
  "sender": "发送者",
  "senderid": "用户ID"
}
```

### 2. 测试写入表格
```
POST /test-sheet
Content-Type: application/json

{
  "sender": "测试用户",
  "senderUserId": "test_123",
  "message": "测试消息"
}
```

### 3. 查看配置
```
GET /config
```

### 4. 健康检查
```
GET /health
```

## 本地开发

```bash
# 安装依赖
npm install

# 开发模式（需要nodemon）
npm run dev

# 生产模式
npm start
```

设置环境变量：
```bash
export SHEET_WEBHOOK_URL="你的Webhook地址"
```

## 注意事项

1. 人员列（ftk5Tx）需要有效的user_id才能正确显示
2. 如果企业微信群机器人不提供user_id，人员列将留空
3. 单选框列固定为"群消息"，如需其他选项可修改代码
4. 确保Render服务和企业微信网络互通