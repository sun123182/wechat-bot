const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// 配置（从环境变量读取）
const SHEET_WEBHOOK_URL = process.env.SHEET_WEBHOOK_URL;

// ========== GET 路由 ==========

// 首页
app.get('/', (req, res) => {
  res.json({
    service: '企业微信消息转智能表格',
    status: '运行中',
    timestamp: new Date().toISOString(),
    description: '接收企业微信群机器人消息，自动写入智能表格',
    endpoints: {
      home: 'GET /',
      config: 'GET /config',
      health: 'GET /health',
      webhook: 'POST /webhook/wecom',
      test_sheet: 'POST /test-sheet'
    }
  });
});

// 配置信息
app.get('/config', (req, res) => {
  res.json({
    sheet_webhook_configured: !!SHEET_WEBHOOK_URL,
    service_url: process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`,
    fields: {
      text: 'f04Gwj',
      single_select: 'ftQMc5',
      number: 'ffFwIh',
      date: 'fn8TJd'
    }
  });
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ========== POST 路由 ==========

// 接收企业微信群机器人Webhook
app.post('/webhook/wecom', async (req, res) => {
  try {
    console.log('收到企业微信消息:', JSON.stringify(req.body, null, 2));
    
    // 解析消息
    const { content, sender } = parseWeComMessage(req.body);
    
    console.log(`解析结果: 发送者=${sender}, 内容=${content}`);
    
    // 写入企业微信智能表格（不传人员列）
    const sheetResult = await writeToWeComSheet(sender, content);
    
    res.json({
      code: 0,
      msg: '消息已接收并写入表格',
      data: {
        sender,
        content,
        timestamp: new Date().toISOString(),
        sheet_result: sheetResult
      }
    });
    
  } catch (error) {
    console.error('处理失败:', error);
    res.status(500).json({
      code: -1,
      msg: '处理失败',
      error: error.message,
      details: error.response?.data
    });
  }
});

// 测试接口 - 直接测试表格写入
app.post('/test-sheet', async (req, res) => {
  const { 
    sender = '测试用户', 
    message = '这是一条测试消息，用于验证表格写入功能。' 
  } = req.body;
  
  try {
    const result = await writeToWeComSheet(sender, message);
    res.json({
      success: true,
      message: '测试写入成功',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data
    });
  }
});

// ========== 工具函数 ==========

// 解析企业微信消息
function parseWeComMessage(body) {
  let content, sender;
  
  // 企业微信群机器人常见格式
  if (body.msgtype === 'text' && body.text && body.text.content) {
    content = body.text.content;
    sender = body.sender || body.from || '未知用户';
  } 
  // 另一种格式
  else if (body.content) {
    content = body.content;
    sender = body.sender || '未知用户';
  }
  // 原始消息
  else if (typeof body === 'string') {
    content = body;
    sender = '未知用户';
  }
  // 其他格式
  else {
    content = JSON.stringify(body);
    sender = '未知用户';
  }
  
  return { content, sender };
}

// 写入企业微信智能表格（简化版，不包含人员列）
async function writeToWeComSheet(sender, message) {
  if (!SHEET_WEBHOOK_URL) {
    throw new Error('未配置SHEET_WEBHOOK_URL');
  }
  
  const timestamp = Date.now().toString(); // 毫秒时间戳
  
  // 简化payload，不包含人员列 ftk5Tx
  const payload = {
    add_records: [
      {
        values: {
          // f04Gwj: 文本列 - 放消息内容
          "f04Gwj": message,
          
          // ftQMc5: 单选框列 - 固定值"群消息"
          "ftQMc5": [
            {
              "text": "群消息"
            }
          ],
          
          // ffFwIh: 数字列 - 消息长度
          "ffFwIh": message.length,
          
          // fn8TJd: 日期列 - 当前时间戳
          "fn8TJd": timestamp
        }
      }
    ]
  };
  
  console.log('发送到表格的payload:', JSON.stringify(payload, null, 2));
  
  const response = await axios.post(SHEET_WEBHOOK_URL, payload, {
    headers: {
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });
  
  return response.data;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 服务器启动，端口: ${PORT}`);
  console.log(`📊 表格Webhook: ${SHEET_WEBHOOK_URL ? '已配置' : '未配置'}`);
  console.log(`🔗 服务地址: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}`);
});
