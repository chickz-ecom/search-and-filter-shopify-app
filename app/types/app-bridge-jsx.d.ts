// @shopify/app-bridge-types (0.7.x) chỉ mở rộng `JSX` global; @types/react 19 đọc `React.JSX`.
// Nối hai bên để dùng được <s-app-nav>, <ui-save-bar>, <s-app-window> trong TSX với React 19.
/// <reference types="@shopify/app-bridge-types" />
import "react";

type AppBridgeIntrinsic = globalThis.JSX.IntrinsicElements;

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface IntrinsicElements extends AppBridgeIntrinsic {}
  }
}
