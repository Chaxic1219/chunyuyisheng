// 金额/文本格式化
function fen2yuan(cents) {
  const n = Number(cents || 0);
  return (n / 100).toFixed(2);
}

function pad(n) {
  return n < 10 ? `0${n}` : String(n);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_TEXT = {
  pending_payment: '待支付',
  paid_pending_profile: '已支付，待补充资料',
  pending_review: '资料审核中',
  active: '服务进行中',
  refunding: '退款处理中',
  refunded: '已退款',
  cancelled: '已取消'
};

function statusText(status) {
  return STATUS_TEXT[status] || status || '未知状态';
}

module.exports = { fen2yuan, fmtDate, statusText };
