const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initDatabase, dbConfig } = require('./database');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// 首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 数据库连接池
let pool;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
  }
  return pool;
}

// ========== 登录认证系统 ==========

// 简单token存储（生产环境用Redis）
const tokenStore = new Map();

// 生成简单token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 验证token的中间件
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: '请先登录' });
  }
  
  const user = tokenStore.get(token);
  if (!user) {
    return res.status(401).json({ error: '登录已失效，请重新登录' });
  }
  
  req.user = user;
  next();
}

// 登录API
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    
    const p = await getPool();
    const [rows] = await p.query(
      'SELECT * FROM staff WHERE loginUser = ? AND loginPwd = ? AND canLogin = 1',
      [username, password]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ error: '用户名或密码错误，或账号未开通登录权限' });
    }
    
    const staff = rows[0];
    const token = generateToken();
    
    // 存储token和用户信息
    tokenStore.set(token, {
      id: staff.id,
      staff_id: staff.staff_id,
      name: staff.name,
      dept: staff.dept,
      role: staff.role
    });
    
    res.json({
      success: true,
      token,
      user: {
        id: staff.id,
        staff_id: staff.staff_id,
        name: staff.name,
        dept: staff.dept,
        role: staff.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 登出API
app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    tokenStore.delete(token);
  }
  res.json({ success: true });
});

// 验证登录状态
app.get('/api/check-auth', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.json({ loggedIn: false });
  }
  
  const user = tokenStore.get(token);
  if (!user) {
    return res.json({ loggedIn: false });
  }
  
  res.json({ loggedIn: true, user });
});

// ========== 工号生成函数（后端核心逻辑）==========
async function generateNextStaffId() {
  const p = await getPool();
  const [rows] = await p.query('SELECT staff_id FROM staff ORDER BY id');
  
  let maxNum = 0;
  rows.forEach(r => {
    const sid = String(r.staff_id || '');
    if (sid.startsWith('BTJ')) {
      const num = parseInt(sid.replace('BTJ', ''), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    } else if (/^\d+$/.test(sid)) {
      const num = parseInt(sid, 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  });
  
  return 'BTJ' + String(maxNum + 1).padStart(3, '0');
}

// ========== 数据验证函数 ==========
function validateStaffData(data, isUpdate = false) {
  const errors = [];
  
  // 必填字段验证
  if (!data.name || data.name.trim() === '') {
    errors.push('姓名不能为空');
  }
  if (!data.dept || data.dept.trim() === '') {
    errors.push('部门不能为空');
  }
  
  // 姓名格式验证
  if (data.name && data.name.length > 50) {
    errors.push('姓名不能超过50个字符');
  }
  
  // 手机号格式验证
  if (data.phone && !/^1[3-9]\d{9}$/.test(data.phone)) {
    errors.push('手机号格式不正确');
  }
  
  // 邮箱格式验证
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.push('邮箱格式不正确');
  }
  
  // 身份证格式验证（18位）
  if (data.idCard && !/^\d{17}[\dXx]$/.test(data.idCard)) {
    errors.push('身份证号格式不正确');
  }
  
  // 工号格式验证（仅新增时检查）
  if (!isUpdate && data.staff_id && !/^BTJ\d{3,}$/.test(data.staff_id)) {
    errors.push('工号格式不正确，应为 BTJxxx 格式');
  }
  
  // 日期格式验证
  if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    errors.push('入职日期格式不正确');
  }
  
  // 银行卡号格式验证（简单验证）
  if (data.bankCard && !/^\d{16,19}$/.test(data.bankCard.replace(/\s/g, ''))) {
    errors.push('银行卡号格式不正确');
  }
  
  return errors;
}

// ========== 员工API ==========

// 获取所有员工
app.get('/api/staff', async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query('SELECT * FROM staff ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取下一个工号（前端调用）
app.get('/api/staff/next-id', async (req, res) => {
  try {
    const nextId = await generateNextStaffId();
    res.json({ staff_id: nextId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 添加员工
app.post('/api/staff', requireAuth, async (req, res) => {
  try {
    // 后端自动生成工号，忽略前端传入的 staff_id
    const staff_id = await generateNextStaffId();
    
    const { name, dept, role, date, status, phone, email, idCard, bankCard, birth, address, emergency, loginUser, loginPwd, canLogin } = req.body;
    
    // 数据验证
    const errors = validateStaffData({ ...req.body, staff_id });
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }
    
    const p = await getPool();
    await p.query(
      'INSERT INTO staff (staff_id, name, dept, role, date, status, phone, email, idCard, bankCard, birth, address, emergency, loginUser, loginPwd, canLogin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [staff_id, name, dept, role, date, status, phone, email, idCard, bankCard, birth, address, emergency, loginUser || '', loginPwd || '', canLogin || 0]
    );
    res.json({ success: true, staff_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新员工
app.put('/api/staff/:id', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    
    // 先获取原数据
    const [rows] = await p.query('SELECT staff_id FROM staff WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '员工不存在' });
    }
    
    // 保持原工号不变
    const originalStaffId = rows[0].staff_id;
    const { name, dept, role, date, status, phone, email, idCard, bankCard, birth, address, emergency, loginUser, loginPwd, canLogin } = req.body;
    
    // 数据验证（更新时不允许修改工号）
    const errors = validateStaffData({ ...req.body, staff_id: originalStaffId }, true);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }
    
    await p.query(
      'UPDATE staff SET staff_id=?, name=?, dept=?, role=?, date=?, status=?, phone=?, email=?, idCard=?, bankCard=?, birth=?, address=?, emergency=?, loginUser=?, loginPwd=?, canLogin=? WHERE id=?',
      [originalStaffId, name, dept, role, date, status, phone, email, idCard, bankCard, birth, address, emergency, loginUser || '', loginPwd || '', canLogin || 0, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除员工
app.delete('/api/staff/:id', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    await p.query('DELETE FROM staff WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 考勤API ==========

// 获取考勤记录（支持按员工和月份筛选）
app.get('/api/attendance', async (req, res) => {
  try {
    const p = await getPool();
    const { staff_id, year, month } = req.query;

    let sql = 'SELECT a.*, s.name as staff_name, s.dept as staff_dept FROM attendance a LEFT JOIN staff s ON a.staff_id COLLATE utf8mb4_unicode_ci = s.staff_id COLLATE utf8mb4_unicode_ci WHERE 1=1';
    const params = [];

    if (staff_id) {
      sql += ' AND a.staff_id = ?';
      params.push(staff_id);
    }

    if (year && month) {
      const startDate = year + '-' + String(month).padStart(2, '0') + '-01';
      const endMonth = parseInt(month) === 12 ? 1 : parseInt(month) + 1;
      const endYear = parseInt(month) === 12 ? parseInt(year) + 1 : parseInt(year);
      const endDate = endYear + '-' + String(endMonth).padStart(2, '0') + '-01';
      sql += ' AND a.date >= ? AND a.date < ?';
      params.push(startDate, endDate);
    }

    sql += ' ORDER BY a.date ASC';

    const [rows] = await p.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取考勤统计
app.get('/api/attendance/stats', async (req, res) => {
  try {
    const p = await getPool();
    const { year, month } = req.query;

    let sql = 'SELECT a.staff_id, s.name as staff_name, s.dept as staff_dept, COUNT(*) as total_days, SUM(CASE WHEN a.status = \'正常\' THEN 1 ELSE 0 END) as normal_days, SUM(CASE WHEN a.status = \'迟到\' THEN 1 ELSE 0 END) as late_days, SUM(CASE WHEN a.status = \'早退\' THEN 1 ELSE 0 END) as early_days, SUM(CASE WHEN a.status = \'请假\' THEN 1 ELSE 0 END) as leave_days FROM attendance a LEFT JOIN staff s ON a.staff_id COLLATE utf8mb4_unicode_ci = s.staff_id COLLATE utf8mb4_unicode_ci';

    const params = [];
    if (year && month) {
      const startDate = year + '-' + String(month).padStart(2, '0') + '-01';
      const endMonth = parseInt(month) === 12 ? 1 : parseInt(month) + 1;
      const endYear = parseInt(month) === 12 ? parseInt(year) + 1 : parseInt(year);
      const endDate = endYear + '-' + String(endMonth).padStart(2, '0') + '-01';
      sql += ' WHERE a.date >= ? AND a.date < ?';
      params.push(startDate, endDate);
    }

    sql += ' GROUP BY a.staff_id, s.name, s.dept ORDER BY a.staff_id';

    const [rows] = await p.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 添加考勤记录
app.post('/api/attendance', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    const { staff_id, date, clock_in, clock_out, status, remark } = req.body;

    if (!staff_id || !date) {
      return res.status(400).json({ error: '员工ID和日期不能为空' });
    }

    await p.query(
      'INSERT INTO attendance (staff_id, date, clock_in, clock_out, status, remark) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE clock_in=VALUES(clock_in), clock_out=VALUES(clock_out), status=VALUES(status), remark=VALUES(remark)',
      [staff_id, date, clock_in || null, clock_out || null, status || '正常', remark || '']
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新考勤记录
app.put('/api/attendance/:id', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    const { clock_in, clock_out, status, remark } = req.body;

    await p.query(
      'UPDATE attendance SET clock_in=?, clock_out=?, status=?, remark=? WHERE id=?',
      [clock_in || null, clock_out || null, status || '正常', remark || '', req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除考勤记录
app.delete('/api/attendance/:id', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    await p.query('DELETE FROM attendance WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 原材料API（需要登录）==========

app.get('/api/raw-materials', async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query('SELECT * FROM raw_materials ORDER BY id');
    for (const r of rows) {
      if (r.cur === 0) r.status = '缺货';
      else if (r.cur < r.safe) r.status = '紧急';
      else if (r.cur < r.safe * 1.5) r.status = '偏低';
      else r.status = '正常';
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/raw-materials', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    const { name, spec, cat, unit, cur, safe } = req.body;

    // 验证必填字段
    if (!name || !cat) {
      return res.status(400).json({ error: '物料名称和类别不能为空' });
    }

    let status = '正常';
    if (cur === 0) status = '缺货';
    else if (cur < safe) status = '紧急';
    else if (cur < safe * 1.5) status = '偏低';

    const [r] = await p.query('INSERT INTO raw_materials (name, spec, cat, unit, cur, safe, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [name, spec, cat, unit, cur, safe, status]);
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/raw-materials/:id', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    const { name, spec, cat, unit, cur, safe } = req.body;

    // 验证必填字段
    if (!name || !cat) {
      return res.status(400).json({ error: '物料名称和类别不能为空' });
    }

    // 根据 cur 和 safe 自动计算状态
    let status = '正常';
    if (cur === 0) status = '缺货';
    else if (cur < safe) status = '紧急';
    else if (cur < safe * 1.5) status = '偏低';

    await p.query('UPDATE raw_materials SET name=?, spec=?, cat=?, unit=?, cur=?, safe=?, status=? WHERE id=?', [name, spec, cat, unit, cur, safe, status, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/raw-materials/:id', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    await p.query('DELETE FROM raw_materials WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 采购物料API（需要登录）==========

app.get('/api/purchased-materials', async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query('SELECT * FROM purchased_materials ORDER BY id');
    for (const r of rows) {
      if (r.cur === 0) r.status = '缺货';
      else if (r.cur < r.safe) r.status = '紧急';
      else if (r.cur < r.safe * 1.5) r.status = '偏低';
      else r.status = '正常';
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchased-materials', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    const { name, spec, cat, unit, cur, safe } = req.body;

    // 验证必填字段
    if (!name || !cat) {
      return res.status(400).json({ error: '物料名称和类别不能为空' });
    }

    let status = '正常';
    if (cur === 0) status = '缺货';
    else if (cur < safe) status = '紧急';
    else if (cur < safe * 1.5) status = '偏低';

    const [r] = await p.query('INSERT INTO purchased_materials (name, spec, cat, unit, cur, safe, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [name, spec, cat, unit, cur, safe, status]);
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/purchased-materials/:id', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    const { name, spec, cat, unit, cur, safe } = req.body;

    // 验证必填字段
    if (!name || !cat) {
      return res.status(400).json({ error: '物料名称和类别不能为空' });
    }

    let status = '正常';
    if (cur === 0) status = '缺货';
    else if (cur < safe) status = '紧急';
    else if (cur < safe * 1.5) status = '偏低';

    await p.query('UPDATE purchased_materials SET name=?, spec=?, cat=?, unit=?, cur=?, safe=?, status=? WHERE id=?', [name, spec, cat, unit, cur, safe, status, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/purchased-materials/:id', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    await p.query('DELETE FROM purchased_materials WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 库存日志API ==========

app.get('/api/stock-logs', async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query('SELECT * FROM stock_logs ORDER BY id DESC LIMIT 100');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stock-logs', async (req, res) => {
  try {
    const p = await getPool();
    const { time, type, name, qty, op, remark } = req.body;
    await p.query('INSERT INTO stock_logs (time, type, name, qty, op, remark) VALUES (?, ?, ?, ?, ?, ?)', [time, type, name, qty, op, remark]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 部门API ==========

app.get('/api/departments', async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query('SELECT * FROM departments ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/departments', async (req, res) => {
  try {
    const p = await getPool();
    const { name, head, count, description } = req.body;
    await p.query('INSERT INTO departments (name, head, count, description) VALUES (?, ?, ?, ?)', [name, head, count || 0, description || '']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/departments/:id', async (req, res) => {
  try {
    const p = await getPool();
    const { name, head, count, description } = req.body;
    await p.query('UPDATE departments SET name=?, head=?, count=?, description=? WHERE id=?', [name, head, count, description, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/departments/:id', async (req, res) => {
  try {
    const p = await getPool();
    await p.query('DELETE FROM departments WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 销售订单API ==========
app.get('/api/sales-orders', async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query('SELECT * FROM sales_orders ORDER BY id DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sales-orders/next-no', async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query("SELECT order_no FROM sales_orders WHERE order_no LIKE ? ORDER BY id DESC LIMIT 1", ['SO' + new Date().getFullYear() + '%']);
    let num = 1;
    if (rows.length) {
      const last = rows[0].order_no.replace('SO' + new Date().getFullYear(), '');
      num = parseInt(last) + 1;
    }
    res.json({ no: 'SO' + new Date().getFullYear() + String(num).padStart(3, '0') });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sales-orders/:id', async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query('SELECT * FROM sales_orders WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '未找到' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sales-orders', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    const toDate = v => v && v.includes('T') ? v.split('T')[0] : v;
    const { order_no, order_name, status, create_date, customer_name, customer_phone, remark } = req.body;
    const [r] = await p.query('INSERT INTO sales_orders (order_no, order_name, status, create_date, customer_name, customer_phone, remark) VALUES (?,?,?,?,?,?,?)',
      [order_no, order_name, status||'待排产', toDate(create_date), customer_name, customer_phone, remark||'']);
    res.json({ success: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/sales-orders/:id', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    const toDate = v => v && v.includes('T') ? v.split('T')[0] : v;
    const { order_no, order_name, status, create_date, customer_name, customer_phone, remark } = req.body;
    await p.query('UPDATE sales_orders SET order_no=?,order_name=?,status=?,create_date=?,customer_name=?,customer_phone=?,remark=? WHERE id=?',
      [order_no, order_name, status, toDate(create_date), customer_name, customer_phone, remark||'', req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/sales-orders/:id', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    await p.query('DELETE FROM sales_orders WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== 订单状态历史 ==========
app.get('/api/order-status-history/:orderId', async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query('SELECT * FROM order_status_history WHERE order_id=? ORDER BY changed_at ASC', [req.params.orderId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/order-status-history', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    const { order_id, status, operator, remark } = req.body;
    const [r] = await p.query('INSERT INTO order_status_history (order_id, status, operator, remark) VALUES (?,?,?,?)',
      [order_id, status, operator||'', remark||'']);
    res.json({ success: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== 生产订单API ==========
app.get('/api/production-orders', async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query(`
      SELECT po.*, so.order_no as sales_order_no
      FROM production_orders po
      LEFT JOIN sales_orders so ON po.sales_order_id = so.id
      ORDER BY po.id DESC
    `);
    // 为每个订单计算实际状态
    const [vehicles] = await p.query('SELECT id FROM workshops WHERE name LIKE ?', ['%车辆总装%']);
    const vehicleWsId = vehicles.length ? vehicles[0].id : 7;
    for (const order of rows) {
      const [logs] = await p.query('SELECT io_type, workshop_id, qty FROM production_logs WHERE production_order_id=?', [order.id]);
      const vehicleInQty = logs.filter(l => String(l.workshop_id) === String(vehicleWsId) && l.io_type === 'in')
        .reduce((s, l) => s + l.qty, 0);
      const hasLogs = logs.length > 0;
      let computedStatus = 'pending';
      if (hasLogs) computedStatus = 'in_progress';
      if (vehicleInQty >= (order.total_qty || 0) && order.total_qty > 0) computedStatus = 'completed';
      order.computedStatus = computedStatus;
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/production-orders', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    const { sales_order_id, product_name, status, total_qty, deadline, remark } = req.body;
    const [r] = await p.query('INSERT INTO production_orders (sales_order_id, product_name, status, total_qty, deadline) VALUES (?,?,?,?,?)',
      [sales_order_id||null, product_name, status||'备料中', total_qty||1, deadline||null]);
    res.json({ success: true, id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/production-orders/:id', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    const { sales_order_id, product_name, total_qty, deadline } = req.body;
    await p.query('UPDATE production_orders SET sales_order_id=?,product_name=?,total_qty=?,deadline=? WHERE id=?',
      [sales_order_id||null, product_name, total_qty||1, deadline||null, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/production-orders/:id', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    await p.query('DELETE FROM production_orders WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== 车间API ==========
app.get('/api/workshops', async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query('SELECT * FROM workshops ORDER BY id');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== 转换规则API ==========
app.get('/api/production-orders/:id/rules', async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query('SELECT * FROM transformation_rules WHERE production_order_id=? ORDER BY group_key, id', [req.params.id]);
    // 按 group_key 分组，收集所有不同的产出（支持1→多）和所有投入（支持多→1）
    const groups = [];
    const groupMap = {};
    for (const r of rows) {
      const gKey = r.group_key;
      if (!groupMap[gKey]) {
        groupMap[gKey] = {
          group_key: gKey,
          workshop_id: r.workshop_id,
          workshop_name: r.workshop_name,
          mode: r.mode || 'input',
          outputs: [],
          inputs: []
        };
        groups.push(groupMap[gKey]);
      }
      // 产出按 material 去重
      if (r.output_material && !groupMap[gKey].outputs.find(o => o.material === r.output_material)) {
        groupMap[gKey].outputs.push({ material: r.output_material, qty: r.output_qty });
      }
      // 投入按 material 去重
      if (r.input_material && !groupMap[gKey].inputs.find(i => i.material === r.input_material)) {
        groupMap[gKey].inputs.push({ material: r.input_material, qty: r.input_qty });
      }
    }
    res.json(groups);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/production-orders/:id/rules', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    await p.query('DELETE FROM transformation_rules WHERE production_order_id=?', [req.params.id]);
    const groups = req.body.groups || [];
    if (Array.isArray(groups) && groups.length) {
      const vals = [];
      for (const g of groups) {
        const gk = g.group_key || ('g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
        const outputs = (g.outputs && g.outputs.length) ? g.outputs : [{ material: g.output_material || '', qty: g.output_qty || 1 }];
        const inputs = g.inputs || [];
        for (const out of outputs) {
          for (const inp of inputs) {
            if (inp.material && out.material) {
              vals.push([req.params.id, g.workshop_id, gk, inp.material, inp.qty || 1, out.material, out.qty || 1, g.mode || 'input']);
            }
          }
        }
      }
      if (vals.length) {
        await p.query('INSERT INTO transformation_rules (production_order_id, workshop_id, group_key, input_material, input_qty, output_material, output_qty, mode) VALUES ?', [vals]);
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 复制规则到其他订单
app.post('/api/production-orders/:id/rules/copy', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    const sourceId = req.params.id;
    const targetId = req.body.targetOrderId;
    if (!targetId || String(targetId) === String(sourceId)) {
      return res.status(400).json({ error: '请选择不同的目标订单' });
    }
    // 读取源订单的所有规则
    const [rows] = await p.query('SELECT workshop_id, group_key, input_material, input_qty, output_material, output_qty, mode FROM transformation_rules WHERE production_order_id=?', [sourceId]);
    if (!rows.length) {
      return res.status(400).json({ error: '源订单没有任何规则可复制' });
    }
    // 生成新的 group_key 避免冲突
    const gkMap = {};
    for (const r of rows) {
      if (!gkMap[r.group_key]) {
        gkMap[r.group_key] = 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      }
    }
    const vals = rows.map(r => [
      targetId,
      r.workshop_id,
      gkMap[r.group_key],
      r.input_material,
      r.input_qty,
      r.output_material,
      r.output_qty,
      r.mode
    ]);
    await p.query('INSERT INTO transformation_rules (production_order_id, workshop_id, group_key, input_material, input_qty, output_material, output_qty, mode) VALUES ?', [vals]);
    res.json({ success: true, copied: vals.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== 车间库存API ==========
app.get('/api/workshop-inventory', async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query('SELECT wi.*, w.name as workshop_name FROM workshop_inventory wi LEFT JOIN workshops w ON wi.workshop_id=w.id ORDER BY wi.id DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/workshop-inventory/in', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    const { production_order_id, workshop_id, material_name, qty, operator, remark } = req.body;

    // 查找该车间该订单的转换规则
    const [allRules] = await p.query(
      'SELECT * FROM transformation_rules WHERE production_order_id=? AND workshop_id=? AND group_key != ""',
      [production_order_id, workshop_id]
    );

    // 按group_key分组
    const groupMap = {};
    for (const r of allRules) {
      if (!groupMap[r.group_key]) {
        groupMap[r.group_key] = { mode: r.mode || 'input', inputs: [], outputs: [] };
      }
      if (r.output_material && !groupMap[r.group_key].outputs.find(o => o.material === r.output_material)) {
        groupMap[r.group_key].outputs.push({ material: r.output_material, qty: r.output_qty || 1 });
      }
      if (r.input_material && !groupMap[r.group_key].inputs.find(i => i.material === r.input_material)) {
        groupMap[r.group_key].inputs.push({ material: r.input_material, qty: r.input_qty || 1 });
      }
    }

    // 查找入库物料属于哪个规则组（多对一：入库产出）
    let matchedGroup = null;
    for (const gk in groupMap) {
      const g = groupMap[gk];
      if (g.mode === 'input' && g.outputs.find(o => o.material === material_name)) {
        matchedGroup = g;
        break;
      }
    }

    if (matchedGroup) {
      // 多对一：入库1个产出，扣减多个原料
      // 先检查所有原料库存是否足够
      for (const inp of matchedGroup.inputs) {
        const deductQty = inp.qty * qty;
        const [raw] = await p.query('SELECT id, cur FROM raw_materials WHERE name=?', [inp.material]);
        const [pur] = await p.query('SELECT id, cur FROM purchased_materials WHERE name=?', [inp.material]);
        const matArr = [...raw, ...pur];
        if (!matArr.length || matArr[0].cur < deductQty) {
          return res.status(400).json({ error: `原料[${inp.material}]库存不足，需要${deductQty}` });
        }
      }
      // 执行扣减
      for (const inp of matchedGroup.inputs) {
        const deductQty = inp.qty * qty;
        const [raw] = await p.query('SELECT id FROM raw_materials WHERE name=?', [inp.material]);
        if (raw.length) {
          await p.query('UPDATE raw_materials SET cur=cur-? WHERE id=?', [deductQty, raw[0].id]);
        } else {
          const [pur] = await p.query('SELECT id FROM purchased_materials WHERE name=?', [inp.material]);
          await p.query('UPDATE purchased_materials SET cur=cur-? WHERE id=?', [deductQty, pur[0].id]);
        }
        await p.query('INSERT INTO production_logs (production_order_id, workshop_id, material_name, io_type, qty, operator, remark) VALUES (?,?,?,?,?,?,?)',
          [production_order_id, workshop_id, inp.material, 'out', deductQty, operator||'', '消耗原料']);

        // 【新增】追溯物料来源车间，给上游车间生成被动出库记录
        const [sourceLog] = await p.query(
          'SELECT workshop_id FROM production_logs WHERE production_order_id=? AND material_name=? AND io_type=? ORDER BY id DESC LIMIT 1',
          [production_order_id, inp.material, 'in']
        );
        if (sourceLog.length && sourceLog[0].workshop_id && sourceLog[0].workshop_id !== workshop_id) {
          await p.query('INSERT INTO production_logs (production_order_id, workshop_id, material_name, io_type, qty, operator, remark) VALUES (?,?,?,?,?,?,?)',
            [production_order_id, sourceLog[0].workshop_id, inp.material, 'out', deductQty, operator||'', `被${workshop_id}号车间消耗`]);
        }
      }
    }

    // 【新增】直入直出车间传递链：加焊工区(4)从校梁拼装(3)扣减，除锈喷涂(6)从加焊工区(4)扣减
    const directChain = { 4: 3, 6: 4 }; // workshop_id -> source workshop_id
    if (directChain[workshop_id]) {
      const sourceWsId = directChain[workshop_id];
      // 检查上游车间库存
      const [srcInv] = await p.query(
        'SELECT id, qty FROM workshop_inventory WHERE production_order_id=? AND workshop_id=? AND material_name=?',
        [production_order_id, sourceWsId, material_name]
      );
      if (!srcInv.length || srcInv[0].qty < qty) {
        return res.status(400).json({ error: `上游车间库存不足，无法传递，当前可用量：${srcInv.length ? srcInv[0].qty : 0}` });
      }
      // 扣减上游车间库存
      await p.query('UPDATE workshop_inventory SET qty=qty-? WHERE id=?', [qty, srcInv[0].id]);
      // 给上游车间记录出库日志
      await p.query('INSERT INTO production_logs (production_order_id, workshop_id, material_name, io_type, qty, operator, remark) VALUES (?,?,?,?,?,?,?)',
        [production_order_id, sourceWsId, material_name, 'out', qty, operator||'', `传递至${workshop_id}号车间`]);
    }

    // 更新车间库存
    const [ex] = await p.query('SELECT id, qty FROM workshop_inventory WHERE production_order_id=? AND workshop_id=? AND material_name=?',
      [production_order_id, workshop_id, material_name]);
    if (ex.length) {
      await p.query('UPDATE workshop_inventory SET qty=qty+? WHERE id=?', [qty, ex[0].id]);
    } else {
      await p.query('INSERT INTO workshop_inventory (production_order_id, workshop_id, material_name, qty) VALUES (?,?,?,?)',
        [production_order_id, workshop_id, material_name, qty]);
    }
    // 记录日志
    await p.query('INSERT INTO production_logs (production_order_id, workshop_id, material_name, io_type, qty, operator, remark) VALUES (?,?,?,?,?,?,?)',
      [production_order_id, workshop_id, material_name, 'in', qty, operator||'', remark||'']);
    // 同步到总库存（半成品）：直入直出车间不重复累加（仅做传递）
    if (!directChain[workshop_id]) {
      const [exRaw] = await p.query('SELECT id, cur FROM raw_materials WHERE name=?', [material_name]);
      if (exRaw.length) {
        await p.query('UPDATE raw_materials SET cur=cur+? WHERE id=?', [qty, exRaw[0].id]);
      } else {
        await p.query('INSERT INTO raw_materials (name, spec, cat, unit, cur, safe, status) VALUES (?,?,?,?,?,?,?)',
          [material_name, '', '半成品', '件', qty, 0, '正常']);
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/workshop-inventory/out', requireAuth, async (req, res) => {
  try {
    const p = await getPool();
    const { production_order_id, workshop_id, material_name, qty, operator, remark } = req.body;

    // 查找该车间所有规则组（按 group_key 分组）
    const [allRules] = await p.query(
      'SELECT * FROM transformation_rules WHERE production_order_id=? AND workshop_id=? AND group_key != ""',
      [production_order_id, workshop_id]
    );

    const groupMap = {};
    for (const r of allRules) {
      if (!groupMap[r.group_key]) {
        groupMap[r.group_key] = {
          workshop_id: r.workshop_id,
          mode: r.mode || 'input',
          outputs: [],
          inputs: []
        };
      }
      // 产出去重
      if (r.output_material && !groupMap[r.group_key].outputs.find(o => o.material === r.output_material)) {
        groupMap[r.group_key].outputs.push({ material: r.output_material, qty: r.output_qty || 1 });
      }
      // 投入去重
      if (r.input_material && !groupMap[r.group_key].inputs.find(i => i.material === r.input_material)) {
        groupMap[r.group_key].inputs.push({ material: r.input_material, qty: r.input_qty || 1 });
      }
    }

    // 查找当前物料属于哪个规则组
    let matchedGroup = null;
    for (const gk in groupMap) {
      const g = groupMap[gk];
      // 一对多：出库原料（在inputs里找）；多对一：出库产出（在outputs里找）
      const isOutputMode = g.mode === 'output';
      const searchArr = isOutputMode ? g.inputs : g.outputs;
      const found = searchArr.find(i => i.material === material_name);
      if (found) {
        matchedGroup = g;
        break;
      }
    }

    const produced = [];

    if (matchedGroup) {
      if (matchedGroup.mode === 'output') {
        // 一对多：出库1个原料 → 产出多个物料
        const deductQty = qty;
        // 扣减原料
        const [inv] = await p.query(
          'SELECT id, qty FROM workshop_inventory WHERE production_order_id=? AND workshop_id=? AND material_name=?',
          [production_order_id, workshop_id, material_name]
        );
        if (!inv.length || inv[0].qty < deductQty) {
          return res.status(400).json({ error: `原料[${material_name}]库存不足，需求${deductQty}` });
        }
        await p.query('UPDATE workshop_inventory SET qty=qty-? WHERE id=?', [deductQty, inv[0].id]);
        await p.query('INSERT INTO production_logs (production_order_id, workshop_id, material_name, io_type, qty, operator, remark) VALUES (?,?,?,?,?,?,?)',
          [production_order_id, workshop_id, material_name, 'out', deductQty, operator||'', '']);
        await syncDeductTotal(material_name, deductQty);
        // 产出所有物料
        for (const out of matchedGroup.outputs) {
          const outQty = out.qty * qty;
          const [ex] = await p.query(
            'SELECT id, qty FROM workshop_inventory WHERE production_order_id=? AND workshop_id=? AND material_name=?',
            [production_order_id, workshop_id, out.material]
          );
          if (ex.length) {
            await p.query('UPDATE workshop_inventory SET qty=qty+? WHERE id=?', [outQty, ex[0].id]);
          } else {
            await p.query('INSERT INTO workshop_inventory (production_order_id, workshop_id, material_name, qty) VALUES (?,?,?,?)',
              [production_order_id, workshop_id, out.material, outQty]);
          }
          await p.query('INSERT INTO production_logs (production_order_id, workshop_id, material_name, io_type, qty, operator, remark) VALUES (?,?,?,?,?,?,?)',
            [production_order_id, workshop_id, out.material, 'in', outQty, operator||'', '自动产出']);
          await syncAddTotal(out.material, outQty);
          produced.push({ material: out.material, qty: outQty });
        }
      } else {
        // 多对一：检查所有原料库存，计算最大可产出套数，扣减所有原料，产出成品
        let maxSets = qty;
        for (const inp of matchedGroup.inputs) {
          const [inv] = await p.query(
            'SELECT id, qty FROM workshop_inventory WHERE production_order_id=? AND workshop_id=? AND material_name=?',
            [production_order_id, workshop_id, inp.material]
          );
          if (!inv.length || inv[0].qty < inp.qty) {
            return res.status(400).json({ error: `原料[${inp.material}]库存不足` });
          }
          const setsFromThis = Math.floor(inv[0].qty / inp.qty);
          if (setsFromThis < maxSets) maxSets = setsFromThis;
        }
        if (maxSets === 0) {
          return res.status(400).json({ error: '库存不足，无法产出' });
        }
        // 执行扣减
        for (const inp of matchedGroup.inputs) {
          const deductQty = inp.qty * maxSets;
          const [inv] = await p.query(
            'SELECT id FROM workshop_inventory WHERE production_order_id=? AND workshop_id=? AND material_name=?',
            [production_order_id, workshop_id, inp.material]
          );
          await p.query('UPDATE workshop_inventory SET qty=qty-? WHERE id=?', [deductQty, inv[0].id]);
          await p.query('INSERT INTO production_logs (production_order_id, workshop_id, material_name, io_type, qty, operator, remark) VALUES (?,?,?,?,?,?,?)',
            [production_order_id, workshop_id, inp.material, 'out', deductQty, operator||'', '']);
          await syncDeductTotal(inp.material, deductQty);
        }
        // 产出入库
        for (const out of matchedGroup.outputs) {
          const outQty = out.qty * maxSets;
          if (outQty > 0) {
            const [ex] = await p.query(
              'SELECT id, qty FROM workshop_inventory WHERE production_order_id=? AND workshop_id=? AND material_name=?',
              [production_order_id, workshop_id, out.material]
            );
            if (ex.length) {
              await p.query('UPDATE workshop_inventory SET qty=qty+? WHERE id=?', [outQty, ex[0].id]);
            } else {
              await p.query('INSERT INTO workshop_inventory (production_order_id, workshop_id, material_name, qty) VALUES (?,?,?,?)',
                [production_order_id, workshop_id, out.material, outQty]);
            }
            await p.query('INSERT INTO production_logs (production_order_id, workshop_id, material_name, io_type, qty, operator, remark) VALUES (?,?,?,?,?,?,?)',
              [production_order_id, workshop_id, out.material, 'in', outQty, operator||'', '自动产出']);
            await syncAddTotal(out.material, outQty);
            produced.push({ material: out.material, qty: outQty });
          }
        }
      }
    } else {
      // 普通出库（无转换规则）：查总库存
      const [raw] = await p.query('SELECT id, cur as qty FROM raw_materials WHERE name=?', [material_name]);
      const [pur] = await p.query('SELECT id, cur as qty FROM purchased_materials WHERE name=?', [material_name]);
      const matArr = [...raw, ...pur];
      if (!matArr.length || matArr[0].qty < qty) {
        return res.status(400).json({ error: `总库存不足` });
      }
      const tbl = raw.length ? 'raw_materials' : 'purchased_materials';
      await p.query(`UPDATE ${tbl} SET cur=cur-? WHERE id=?`, [qty, matArr[0].id]);
      await p.query('INSERT INTO production_logs (production_order_id, workshop_id, material_name, io_type, qty, operator, remark) VALUES (?,?,?,?,?,?,?)',
        [production_order_id, workshop_id, material_name, 'out', qty, operator||'', remark||'']);
    }

    res.json({ success: true, produced });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 辅助：同步扣减总库存
async function syncDeductTotal(name, qty) {
  const pool = await getPool();
  const [r] = await pool.query('SELECT id, cur FROM raw_materials WHERE name=?', [name]);
  if (r.length) { await pool.query('UPDATE raw_materials SET cur=cur-? WHERE id=?', [qty, r[0].id]); return; }
  const [p] = await pool.query('SELECT id, cur FROM purchased_materials WHERE name=?', [name]);
  if (p.length) { await pool.query('UPDATE purchased_materials SET cur=cur-? WHERE id=?', [qty, p[0].id]); }
}

// 辅助：同步增加总库存
async function syncAddTotal(name, qty) {
  const pool = await getPool();
  const [r] = await pool.query('SELECT id, cur FROM raw_materials WHERE name=?', [name]);
  if (r.length) { await pool.query('UPDATE raw_materials SET cur=cur+? WHERE id=?', [qty, r[0].id]); return; }
  const [p] = await pool.query('SELECT id, cur FROM purchased_materials WHERE name=?', [name]);
  if (p.length) { await pool.query('UPDATE purchased_materials SET cur=cur+? WHERE id=?', [qty, p[0].id]); }
}

// ========== 生产进度 ==========
app.get('/api/production-orders/:id/progress', async (req, res) => {
  try {
    const p = await getPool();
    const [orders] = await p.query('SELECT * FROM production_orders WHERE id=?', [req.params.id]);
    if (!orders.length) return res.status(404).json({ error: '未找到' });
    const order = orders[0];
    const [inv] = await p.query('SELECT wi.*, w.name as workshop_name FROM workshop_inventory wi LEFT JOIN workshops w ON wi.workshop_id=w.id WHERE wi.production_order_id=?', [req.params.id]);
    const [logs] = await p.query('SELECT pl.*, w.name as workshop_name FROM production_logs pl LEFT JOIN workshops w ON pl.workshop_id=w.id WHERE pl.production_order_id=? ORDER BY pl.id DESC', [req.params.id]);

    // 自动计算订单状态
    const [vehicles] = await p.query('SELECT id FROM workshops WHERE name LIKE ?', ['%车辆总装%']);
    const vehicleWsId = vehicles.length ? vehicles[0].id : 7;
    const vehicleInQty = logs.filter(l => String(l.workshop_id) === String(vehicleWsId) && l.io_type === 'in')
      .reduce((s, l) => s + l.qty, 0);
    const hasLogs = logs.length > 0;
    let computedStatus = 'pending';
    if (hasLogs) computedStatus = 'in_progress';
    if (vehicleInQty >= (order.total_qty || 0) && order.total_qty > 0) computedStatus = 'completed';

    // 计算各车间物料的结余（in - out）
    const balances = {};
    for (const l of logs) {
      const key = `${l.workshop_id}_${l.material_name}`;
      if (!balances[key]) balances[key] = { in: 0, out: 0 };
      if (l.io_type === 'in') balances[key].in += l.qty;
      else balances[key].out += l.qty;
    }
    for (const k in balances) { balances[k].balance = balances[k].in - balances[k].out; }

    res.json({ order, inventory: inv, logs, computedStatus, balances });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== 生产日志API ==========
app.get('/api/production-logs', async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query('SELECT pl.*, w.name as workshop_name, po.product_name FROM production_logs pl LEFT JOIN workshops w ON pl.workshop_id=w.id LEFT JOIN production_orders po ON pl.production_order_id=po.id ORDER BY pl.id DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== 启动服务器 ==========

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await initDatabase();
    console.log('✅ 数据库就绪');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 服务器运行在 http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error('❌ 启动失败:', err);
    process.exit(1);
  }
}

start();
