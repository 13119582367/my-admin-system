const mysql = require('mysql2/promise');

async function insert() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    socketPath: '/var/run/mysqld/mysqld.sock',
    charset: 'utf8mb4',
    database: 'btj_management'
  });
  
  await conn.query('DELETE FROM departments');
  
  const depts = [
    ['销售部', '张明远', 8, '负责产品销售与客户维护'],
    ['技术部', '王建国', 12, '研发、设计与技术支持'],
    ['财务部', '李晓燕', 5, '财务核算、成本控制'],
    ['人事部', '陈美玲', 4, '招聘、培训与员工关系'],
    ['运营部', '刘宇轩', 7, '日常运营与流程优化'],
    ['生产部', '吴大伟', 12, '产品生产、质检与交付']
  ];
  
  for (const d of depts) {
    await conn.query('INSERT INTO departments (name, head, count, description) VALUES (?, ?, ?, ?)', d);
  }
  
  console.log('✅ 部门数据插入成功');
  await conn.end();
}

insert().catch(console.error);
