const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'btj_management',
  socketPath: '/var/run/mysqld/mysqld.sock',
  charset: 'utf8mb4'
};

async function initDatabase() {
  // 先连接不带数据库，创建数据库
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    socketPath: '/var/run/mysqld/mysqld.sock'
  });

  await connection.query('CREATE DATABASE IF NOT EXISTS btj_management');
  await connection.query('USE btj_management');

  // 创建员工表
  await connection.query(`
    CREATE TABLE IF NOT EXISTS staff (
      id INT AUTO_INCREMENT PRIMARY KEY,
      staff_id VARCHAR(50) UNIQUE,
      name VARCHAR(100),
      dept VARCHAR(100),
      role VARCHAR(100),
      date DATE,
      status VARCHAR(20),
      phone VARCHAR(20),
      email VARCHAR(100),
      idCard VARCHAR(50),
      bankCard VARCHAR(50),
      birth DATE,
      address TEXT,
      emergency VARCHAR(200),
      loginUser VARCHAR(50),
      loginPwd VARCHAR(100),
      canLogin TINYINT DEFAULT 0
    )
  `);

  // 创建原材料表
  await connection.query(`
    CREATE TABLE IF NOT EXISTS raw_materials (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(200),
      spec VARCHAR(200),
      cat VARCHAR(50),
      unit VARCHAR(20),
      cur INT DEFAULT 0,
      safe INT DEFAULT 0,
      status VARCHAR(20)
    )
  `);

  // 创建采购物料表
  await connection.query(`
    CREATE TABLE IF NOT EXISTS purchased_materials (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(200),
      spec VARCHAR(200),
      cat VARCHAR(50),
      unit VARCHAR(20),
      cur INT DEFAULT 0,
      safe INT DEFAULT 0,
      status VARCHAR(20)
    )
  `);

  // 创建库存日志表
  await connection.query(`
    CREATE TABLE IF NOT EXISTS stock_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      time DATETIME,
      type VARCHAR(10),
      name VARCHAR(200),
      qty INT,
      op VARCHAR(100),
      remark TEXT
    )
  `);

  // 创建部门表
  await connection.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100),
      head VARCHAR(100),
      count INT DEFAULT 0,
      description TEXT
    )
  `);

  // 创建订单状态历史表
  await connection.query(`
    CREATE TABLE IF NOT EXISTS order_status_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      status VARCHAR(50) NOT NULL,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      operator VARCHAR(100),
      remark TEXT,
      INDEX idx_order_id (order_id)
    )
  `);

  // 初始化默认数据
  const [rows] = await connection.query('SELECT COUNT(*) as count FROM staff');
  if (rows[0].count === 0) {
    // 插入默认员工
    await connection.query(`
      INSERT INTO staff (staff_id, name, dept, role, date, status, phone, email, idCard, bankCard, birth, address, emergency, loginUser, loginPwd, canLogin) VALUES
      ('BTJ001', '张明远', '销售部', '销售经理', '2021-03-15', '在职', '13800008001', 'zhangmy@beitoujia.com', '320***********1234', '6222021234567890123', '1988-05-15', '江苏省南京市秦淮区中华路128号', '张明华 13800008888', '', '', 0),
      ('BTJ002', '李晓燕', '财务部', '会计师', '2020-07-01', '在职', '13800008002', 'lixy@beitoujia.com', '320***********5678', '6222021234567890124', '1990-08-22', '江苏省南京市鼓楼区中山路56号', '李大海 13900008888', '', '', 0),
      ('BTJ003', '王建国', '技术部', '高级工程师', '2019-11-20', '在职', '13800008003', 'wangjg@beitoujia.com', '320***********9012', '6222021234567890125', '1985-12-01', '江苏省南京市江宁区百家湖花园12栋301室', '王建军 13700008888', 'wangjg', '123456', 1),
      ('BTJ004', '陈美玲', '人事部', 'HR专员', '2022-05-08', '试用', '13800008004', 'chenml@beitoujia.com', '320***********3456', '6222021234567890126', '1995-03-18', '江苏省南京市玄武区中山东路88号', '陈大明 13600008888', '', '', 0),
      ('BTJ005', '刘宇轩', '运营部', '运营主管', '2020-02-14', '在职', '13800008005', 'liuyx@beitoujia.com', '320***********7890', '6222021234567890127', '1992-11-25', '江苏省南京市栖霞区仙林大道168号', '刘志明 13500008888', '', '', 0),
      ('BTJ006', '赵小雨', '销售部', '销售代表', '2023-09-01', '试用', '13800008006', 'zhaoxy@beitoujia.com', '320***********2345', '6222021234567890128', '1998-07-10', '江苏省南京市浦口区大桥北路29号', '赵大海 13400008888', '', '', 0),
      ('BTJ007', '孙志远', '技术部', '前端开发', '2022-12-05', '离职', '13800008007', 'sunzy@beitoujia.com', '320***********6789', '6222021234567890129', '1996-09-05', '江苏省南京市雨花台区软件大道66号', '孙明亮 13300008888', '', '', 0),
      ('BTJ008', '周芳芳', '生产部', '质检员', '2021-08-16', '在职', '13800008008', 'zhouff@beitoujia.com', '320***********0123', '6222021234567890130', '1993-04-12', '江苏省南京市六合区雄州镇延安路88号', '周大海 13200008888', '', '', 0),
      ('BTJ009', '吴大伟', '生产部', '车间主任', '2018-06-10', '在职', '13800008009', 'wudw@beitoujia.com', '320***********4567', '6222021234567890131', '1980-10-30', '江苏省南京市高淳区淳溪镇中山路55号', '吴小明 13100008888', '', '', 0)
    `);

    // 插入默认原材料
    await connection.query(`
      INSERT INTO raw_materials (name, spec, cat, unit, cur, safe, status) VALUES
      ('热轧钢板 Q235', '10×1500×6000mm', '钢板', '张', 28, 20, '偏低'),
      ('热轧钢板 Q345', '12×1800×8000mm', '钢板', '张', 12, 15, '紧急'),
      ('花纹钢板', '4×1250×6000mm', '钢板', '张', 8, 10, '紧急'),
      ('H型钢 HN300', '300×150×6.5×9mm', '型材', '根', 35, 20, '正常'),
      ('工字钢 I25b', '250×120×10mm', '型材', '根', 4, 15, '紧急'),
      ('扁钢 -40×4', '-40×4mm', '其他', '米', 120, 50, '正常'),
      ('矩形管 120×80', '120×80×5mm Q235', '型材', '根', 22, 25, '紧急'),
      ('方管 100×100', '100×100×4mm Q235', '型材', '根', 18, 20, '紧急')
    `);

    // 插入默认采购物料
    await connection.query(`
      INSERT INTO purchased_materials (name, spec, cat, unit, cur, safe, status) VALUES
      ('重卡轮胎 12.00R20', '12.00R20 无内胎', '轮胎', '条', 16, 20, '紧急'),
      ('重卡轮胎 11.00R20', '11.00R20 有内胎', '轮胎', '条', 6, 10, '紧急'),
      ('空气悬挂总成', '三桥空气悬挂', '悬挂', '套', 4, 6, '紧急'),
      ('钢板悬挂总成', '三桥钢板弹簧', '悬挂', '套', 3, 5, '紧急'),
      ('轮毂轴承单元', 'BPW 12T 后轮毂', '轴承', '套', 14, 12, '偏低'),
      ('U型螺栓 M22', '悬挂专用 M22×220', '螺栓', '套', 48, 30, '正常'),
      ('骑马螺栓 M20', '骑马螺栓 M20×160', '螺栓', '套', 9, 20, '紧急'),
      ('ABS防抱死传感器', '4S/2M 标配', '其他', '个', 20, 15, '偏低')
    `);

    // 插入默认日志
    await connection.query(`
      INSERT INTO stock_logs (time, type, name, qty, op, remark) VALUES
      ('2026-03-28 10:23', 'in', '热轧钢板 Q235', 10, '张师傅', '新到Q235钢板'),
      ('2026-03-28 09:15', 'out', 'H型钢 HN300', -8, '李工', '大梁#3201用料'),
      ('2026-03-27 16:40', 'in', '重卡轮胎 12.00R20', 20, '王采购', '补货'),
      ('2026-03-27 14:30', 'out', '重卡轮胎 12.00R20', -4, '张师傅', '挂车#108装配'),
      ('2026-03-27 11:00', 'in', '热轧钢板 Q345', 8, '张师傅', '加硬钢板上新线'),
      ('2026-03-26 15:20', 'out', '空气悬挂总成', -2, '李工', '订单#2203'),
      ('2026-03-26 10:05', 'in', 'U型螺栓 M22', 30, '王采购', '标准件补货'),
      ('2026-03-25 14:50', 'out', '矩形管 120×80', -6, '张师傅', '横梁#2021')
    `);

    // 插入默认部门
    await connection.query(`
      INSERT INTO departments (name, head, count, description) VALUES
      ('销售部', '张明远', 8, '负责产品销售与客户维护'),
      ('技术部', '王建国', 12, '研发、设计与技术支持'),
      ('财务部', '李晓燕', 5, '财务核算、成本控制'),
      ('人事部', '陈美玲', 4, '招聘、培训与员工关系'),
      ('运营部', '刘宇轩', 7, '日常运营与流程优化'),
      ('生产部', '吴大伟', 12, '产品生产、质检与交付')
    `);
  }

  console.log('✅ 数据库初始化完成');
  await connection.end();
}

module.exports = { initDatabase, dbConfig };
