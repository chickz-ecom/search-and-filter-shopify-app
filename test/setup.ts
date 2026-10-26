// Nạp .env.test cho mọi test (giá trị giả; dịch vụ thật chỉ dùng trong *.int.test.ts).
import { existsSync } from "node:fs";

if (existsSync(".env.test")) process.loadEnvFile(".env.test");
