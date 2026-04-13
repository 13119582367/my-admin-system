const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'btj_management',
  socketPath: '/var/run/mysqld/mysqld.sock',
  charset: 'utf8mb4'
};

async function insertHistory() {
  const connection = await mysql.createConnection(dbConfig);

  // 检查是否已有历史数据
  const [existing] = await connection.query('SELECT COUNT(*) as cnt FROM order_status_history');
  if (existing[0].cnt > 0) {
    console.log('历史数据已存在，跳过插入');
    await connection.end();
    return;
  }

  // 为每个订单插入状态历史
  const orders = [
    { id: 1, status: '已结清', history: [
      { status: '待排产', days: -25, operator: '张明远' },
      { status: '采购中', days: -20, operator: '张明远' },
      { status: '生产中', days: -15, operator: '王建国' },
      { status: '组装中', days: -10, operator: '王建国' },
      { status: '待验收', days: -5, operator: '张明远' },
      { status: '已发货', days: -3, operator: '张明远' },
      { status: '已结清', days: 0, operator: '李晓燕' }
    ]},
    { id: 2, status: '待排产', history: [
      { status: '待排产', days: -5, operator: '张明远' }
    ]},
    { id: 3, status: '已发货', history: [
      { status: '待排产', days: -15, operator: '张明远' },
      { status: '采购中', days: -12, operator: '张明远' },
      { status: '生产中', days: -10, operator: '王建国' },
      { status: '组装中', days: -6, operator: '王建国' },
      { status: '待验收', days: -4, operator: '张明远' },
      { status: '已发货', days: 0, operator: '张明远' }
    ]},
    { id: 4, status: '采购中', history: [
      { status: '待排产', days: -7, operator: '张明远' },
      { status: '采购中', days: -3, operator: '张明远' }
    ]},
    { id: 5, status: '组装中', history: [
      { status: '待排产', days: -20, operator: '张明远' },
      { status: '采购中', days: -18, operator: '张明远' },
      { status: '生产中', days: -14, operator: '王建国' },
      { status: '组装中', days: -5, operator: '王建国' }
    ]},
    { id: 6, status: '已结清', history: [
      { status: '待排产', days: -50, operator: '张明远' },
      { status: '采购中', days: -45, operator: '张明远' },
      { status: '生产中', days: -40, operator: '王建国' },
      { status: '组装中', days: -30, operator: '王建国' },
      { status: '待验收', days: -20, operator: '张明远' },
      { status: '已发货', days: -15, operator: '张明远' },
      { status: '已结清', days: -10, operator: '李晓燕' }
    ]},
    { id: 7, status: '待排产', history: [
      { status: '待排产', days: -2, operator: '张明远', remark: '新订单录入' }
    ]}
  ];

  for (const order of orders) {
    for (const h of order.history) {
      const date = new Date();
      date.setDate(date.getDate() + h.days);
      const changedAt = date.toISOString().slice(0, 19).replace('T', ' ');

      await connection.query(
        'INSERT INTO order_status_history (order_id, status, changed_at, operator) VALUES (?, ?, ?, ?)',
        [order.id, h.status, changedAt, h.operator]
      );
      console.log(`插入: order ${order.id} - ${h.status} (${changedAt})`);
    }
  }

  console.log('✅ 状态历史数据插入完成');
  await connection.end();
}

insertHistory().catch(e => {
  console.error('插入失败:', e);
  process.exit(1);
});