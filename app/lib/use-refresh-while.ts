import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

/**
 * Gọi lại loader định kỳ khi `active` (vd. sync đang QUEUED/RUNNING) để trạng thái + tiến độ tự cập nhật, không cần
 * reload trang. Bỏ qua khi tab ẩn hoặc lượt trước chưa xong; dừng ngay khi `active` = false.
 */
export function useRefreshWhile(active: boolean, ms = 3000) {
  const revalidator = useRevalidator();
  const ref = useRef(revalidator);
  useEffect(() => {
    ref.current = revalidator;
  });

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && ref.current.state === "idle")
        void ref.current.revalidate();
    }, ms);
    return () => clearInterval(id);
  }, [active, ms]);
}
