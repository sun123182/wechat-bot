const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// 配置（从环境变量读取）
const SHEET_WEBHOOK_URL = process.env.SHEET_WEBHOOK_URL;

// 接收企业微信群机器人Webhook
app.post('/webhook/wecom', async (req, res) => {
  try {
    console.log('收到企业微信消息:', JSON.stringify(req.body, null, 2));
    
    // 解析消息
    const { content, sender, senderUserId } = parseWeComMessage(req.body);
    
    console.log(`解析结果: 发送者=${sender}, 用户ID=${senderUserId}, 内容=${content}`);
    
    // 写入企业微信智能表格
    const sheetResult = await writeToWeComSheet(sender, senderUserId, content);
    
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

// 解析企业微信消息
function parseWeComMessage(body) {
  let content, sender, senderUserId;
  
  // 企业微信群机器人常见格式
  if (body.msgtype === 'text' && body.text && body.text.content) {
    content = body.text.content;
    sender = body.sender || body.from || '未知用户';
    senderUserId = body.senderid || body.userid || '';
  } 
  // 另一种格式
  else if (body.content) {
    content = body.content;
    sender = body.sender || '未知用户';
    senderUserId = body.senderid || body.userid || '';
  }
  // 原始消息
  else if (typeof body === 'string') {
    content = body;
    sender = '未知用户';
    senderUserId = '';
  }
  // 其他格式
  else {
    content = JSON.stringify(body);
    sender = '未知用户';
    senderUserId = '';
  }
  
  return { content, sender, senderUserId };
}

// 写入企业微信智能表格
async function writeToWeComSheet(sender, senderUserId, message) {
  if (!SHEET_WEBHOOK_URL) {
    throw new Error('未配置SHEET_WEBHOOK_URL');
  }
  
  const timestamp = Date.now().toString(); // 毫秒时间戳
  
  // 根据你的示例构建payload
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
  
  // 如果有senderUserId，添加人员列
  if (senderUserId) {
    payload.add_records[0].values.ftk5Tx = [
      {
        "user_id": senderUserId
      }
    ];
  }
  
  console.log('发送到表格的payload:', JSON.stringify(payload, null, 2));
  
  const response = await axios.post(SHEET_WEBHOOK_URL, payload, {
    headers: {
      'Content-Type': 'application/json'
    },
    timeout: 10000 // 10秒超时
  });
  
  return response.data;
}

// 测试接口 - 直接测试表格写入
app.post('/test-sheet', async (req, res) => {
  const { 
    sender = '测试用户', 
    senderUserId = 'test_user_123', 
    message = '这是一条测试消息，用于验证表格写入功能。' 
  } = req.body;
  
  try {
    const result = await writeToWeComSheet(sender, senderUserId, message);
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

// 模拟企业微信消息格式的测试
app.post('/test-wecom-format', async (req, res) => {
  // 模拟企业微信群机器人的消息格式
  const mockWeComMessage = {
    msgtype: 'text',
    text: {
      content: '这是一条模拟的企业微信消息'
    },
    sender: '张三',
    senderid: 'zhangsan123',
    from: '群聊名称'
  };
  
  try {
    const { content, sender, senderUserId } = parseWeComMessage(mockWeComMessage);
    const result = await writeToWeComSheet(sender, senderUserId, content);
    
    res.json({
      success: true,
      message: '模拟消息测试成功',
      parsed: { content, sender, senderUserId },
      result: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取环境信息
app.get('/config', (req, res) => {
  res.json({
    sheet_webhook_configured: !!SHEET_WEBHOOK_URL,
    service_url: process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`,
    fields: {
      text: 'f04Gwj',
      single_select: 'ftQMc5',
      person: 'ftk5Tx',
      number: 'ffFwIh',
      date: 'fn8TJd'
    },
    endpoints: {
      webhook: 'POST /webhook/wecom',
      test_sheet: 'POST /test-sheet',
      test_wecom: 'POST /test-wecom-format',
      config: 'GET /config',
      health: 'GET /health'
    }
  });
});

// 健康检查
app.get('/', (req, res) => {
  res.json({
    service: '企业微信消息转智能表格',
    status: '运行中',
    timestamp: new Date().toISOString(),
    description: '接收企业微信群机器人消息，自动写入智能表格'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 服务器启动，端口: ${PORT}`);
  console.log(`📊 表格Webhook: ${SHEET_WEBHOOK_URL ? '已配置' : '未配置'}`);
  console.log(`🔗 服务地址: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}`);
  console.log(`📝 可用接口:`);
  console.log(`   POST /webhook/wecom - 接收企业微信消息`);
  console.log(`   POST /test-sheet - 测试写入表格`);
  console.log(`   GET /config - 查看配置`);
});