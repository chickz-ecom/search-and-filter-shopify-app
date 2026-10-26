// Lớp phòng thủ thứ hai cho template merchant lưu ở Appearance (security check 6.3): admin đã kiểm tra theo danh sách
// cho phép lúc lưu; SDK vẫn gỡ thẻ/thuộc tính nguy hiểm khi nạp config (template cũ, dữ liệu bị sửa ngoài app).
// Phân tích trong <template> (trơ: không tải ảnh, không chạy handler). Không có gì nguy hiểm → trả nguyên chuỗi
// (không serialize lại, giữ nguyên placeholder {{…}} đặt trong thẻ).
const BAD_TAGS =
  /^(script|iframe|object|embed|style|link|meta|base|form|svg|math|template|frame|frameset)$/i;
const URL_ATTR = /(^|:)(href|src|action|formaction)$/i;
const BAD_URL = /^(javascript|data|vbscript):/i;

export function sanitizeTemplate(html: string): string {
  if (typeof document === "undefined") return html;
  const t = document.createElement("template");
  t.innerHTML = html;
  let dirty = false;
  for (const el of Array.from(t.content.querySelectorAll("*"))) {
    if (BAD_TAGS.test(el.tagName)) {
      el.remove();
      dirty = true;
      continue;
    }
    for (const a of Array.from(el.attributes)) {
      // eslint-disable-next-line no-control-regex -- cố ý: loại ký tự điều khiển khỏi URL (security 6.3)
      const url = a.value.replace(/[\s\u0000-\u001f]/g, "");
      if (/^on/i.test(a.name) || (URL_ATTR.test(a.name) && BAD_URL.test(url))) {
        el.removeAttribute(a.name);
        dirty = true;
      }
    }
  }
  return dirty ? t.innerHTML : html;
}
