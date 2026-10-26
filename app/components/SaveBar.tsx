import { useEffect } from "react";

// Contextual Save Bar (BFS: mọi form). Dạng lập trình <ui-save-bar> + shopify.saveBar vì state do React quản lý
// (data-save-bar không thấy thay đổi không qua input event — docs/shopify-api/storefront-apphome.md mục 6).
// Không ẩn khi lưu lỗi: chỉ ẩn khi `dirty` về false (sau khi backend xác nhận).

export type SaveBarProps = {
  id: string;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  labels: { save: string; discard: string };
};

export function SaveBar({ id, dirty, saving, onSave, onDiscard, labels }: SaveBarProps) {
  useEffect(() => {
    if (typeof shopify === "undefined" || !shopify.saveBar) return;
    void (dirty ? shopify.saveBar.show(id) : shopify.saveBar.hide(id));
  }, [dirty, id]);
  useEffect(
    () => () => {
      if (typeof shopify !== "undefined") void shopify.saveBar?.hide(id);
    },
    [id],
  );
  return (
    <ui-save-bar id={id} discardConfirmation>
      <button {...{ variant: "primary" }} {...(saving ? { loading: "" } : {})} onClick={onSave}>
        {labels.save}
      </button>
      <button onClick={onDiscard}>{labels.discard}</button>
    </ui-save-bar>
  );
}
