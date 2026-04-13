const fs = require('fs');
let c = fs.readFileSync('/home/ubuntu/btj-app/index.html', 'utf8');

// 添加CSS
const newCss = `    @media(max-width:768px){
    .sidebar{display:none}
    .login-brand{display:none}
    .login-wrap{width:94%!important;min-height:auto}
    .content-area{padding:12px;margin-left:0;margin-top:50px}
    .topbar{height:50px}
    .mobile-menu-btn{display:flex}
    .mobile-nav{display:flex}
    .table-wrap{overflow-x:auto}
    .modal{width:95%!important}
    .content-area{padding-bottom:70px}
    }`;

const oldCss = '@media(max-width:768px){.sidebar{display:none}.login-brand{display:none}.login-wrap{width:94%}.content-area{padding:14px}.settings-grid{grid-template-columns:1fr}.attend-grid{grid-template-columns:1fr}}';
c = c.replace(oldCss, newCss);

const extraCss = `.mobile-menu-btn{display:none;position:fixed;top:12px;left:12px;z-index:10001;width:36px;height:36px;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);align-items:center;justify-content:center;cursor:pointer;border:none}
.mobile-menu-btn span{display:block;width:20px;height:2px;background:#333;position:relative}
.mobile-menu-btn span:before,.mobile-menu-btn span:after{content:'';position:absolute;width:20px;height:2px;background:#333;left:0}
.mobile-menu-btn span:before{top:-6px}
.mobile-menu-btn span:after{top:6px}
.mobile-nav{display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;box-shadow:0 -2px 10px rgba(0,0,0,.1);z-index:9998;padding:8px 0;justify-content:space-around}
.mobile-nav-item{flex:1;text-align:center;font-size:11px;color:#64748b}
.mobile-nav-item.active{color:#2563eb}`;

c = c.replace('</style>', extraCss + '\n</style>');

// 添加HTML
const mobileHtml = `<button class="mobile-menu-btn" onclick="toggleSidebar()"><span></span></button>
<div class="sidebar-backdrop" onclick="toggleSidebar()"></div>
<div class="mobile-nav">
  <div class="mobile-nav-item active" onclick="switchModule('inventory');closeSidebar()">
    <i>📦</i><span>库存</span>
  </div>
  <div class="mobile-nav-item" onclick="switchModule('staff');closeSidebar()">
    <i>👥</i><span>员工</span>
  </div>
  <div class="mobile-nav-item" onclick="switchModule('attend');closeSidebar()">
    <i>📅</i><span>考勤</span>
  </div>
  <div class="mobile-nav-item" onclick="switchModule('salary');closeSidebar()">
    <i>💰</i><span>薪资</span>
  </div>
</div>`;

c = c.replace('<body>', '<body>\n' + mobileHtml);

// 添加JS
const jsCode = `
function toggleSidebar(){
  var sb=document.querySelector('.sidebar');
  var bd=document.querySelector('.sidebar-backdrop');
  sb.classList.toggle('open');
  bd.classList.toggle('show');
}
function closeSidebar(){
  var sb=document.querySelector('.sidebar');
  var bd=document.querySelector('.sidebar-backdrop');
  sb.classList.remove('open');
  bd.classList.remove('show');
}
var _sw=switchModule;
switchModule=function(m){_sw(m);if(window.innerWidth<=768){var its=document.querySelectorAll('.mobile-nav-item');its.forEach(function(x){x.classList.remove('active')});if(m==='inventory'||m==='raw'||m==='purchased'||m==='stock-log'||m==='alert'||m==='settings'){its[0].classList.add('active')}else if(m==='staff'||m==='dept'){its[1].classList.add('active')}else if(m==='attend'){its[2].classList.add('active')}else if(m==='salary'){its[3].classList.add('active')}}};
`;

c = c.replace('</script>', jsCode + '</script>');

fs.writeFileSync('/home/ubuntu/btj-app/index.html', c);
console.log('Done');
