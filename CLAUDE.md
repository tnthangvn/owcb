# owcb — Agent Guide

Kho tài liệu kiến trúc và luồng nghiệp vụ dạng web tĩnh (GitHub Pages), không có source code chạy được.

## Cấu trúc

- `index.html` — trang gốc liệt kê các project (sinh bởi script, không sửa tay).
- `<project>/` — một site con cho mỗi project: `index.html` (sidemap), các page Archify `*.vi.html` / `*.en.html`, `manifest.json`, `src/` (inventory, candidate, report), `legacy/` (bản cũ).
- `.agents/skills/codebase-workflow/` — skill sinh toàn bộ site này; `.agents/skills/archify/` — renderer sơ đồ. `.claude/skills/` symlink về đây.
- `.codegraph/` — dữ liệu index local, không commit.

## Quy ước

- `CLAUDE.md` là nguồn duy nhất; `AGENTS.md`, `AGENT.md`, `GEMINI.md`, `.github/copilot-instructions.md` là symlink tới file này — chỉ sửa `CLAUDE.md`.
- Mọi `index.html` do `node .agents/skills/codebase-workflow/scripts/build-site.mjs .` sinh từ `manifest.json` — không sửa tay. Thêm/sửa page thì sửa `manifest.json` rồi build lại.
- Link chỉ dùng đường dẫn tương đối; không `file://`, không path tuyệt đối máy local. Không đưa giá trị secret lên page.
- Mặc định song ngữ vi + en.

## Cách làm việc

> Theo [andrej-karpathy-skills/CLAUDE.md](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md): giảm các lỗi hay gặp khi AI viết code. Ưu tiên cẩn thận hơn tốc độ; việc nhỏ, hiển nhiên thì tự cân nhắc.

### 1. Nghĩ trước khi code

**Không đoán. Không giấu chỗ chưa rõ. Nói ra các lựa chọn và đánh đổi.**

- Nêu rõ giả định trước khi làm. Không chắc thì hỏi.
- Yêu cầu hiểu được nhiều cách thì đưa ra các cách hiểu, không tự chọn im lặng.
- Có cách đơn giản hơn thì nói ra. Thấy yêu cầu chưa hợp lý thì phản biện.
- Có chỗ chưa rõ thì dừng lại, nói rõ chỗ đó, rồi hỏi.

### 2. Đơn giản trước

**Ít code nhất mà giải quyết được vấn đề. Không viết cho tương lai.**

- Không thêm tính năng ngoài yêu cầu.
- Không tạo abstraction cho code chỉ dùng một lần.
- Không thêm "linh hoạt" hay "cấu hình được" khi không ai yêu cầu.
- Không xử lý lỗi cho tình huống không thể xảy ra.
- Viết 200 dòng mà 50 dòng là đủ thì viết lại.

Tự hỏi: "Senior engineer nhìn vào có thấy rườm rà không?" Có thì rút gọn.

### 3. Sửa đúng chỗ cần sửa

**Chỉ đụng vào phần phải đụng. Chỉ dọn phần rác do mình tạo ra.**

Khi sửa code có sẵn:

- Không "tiện tay cải thiện" code, comment hay format bên cạnh.
- Không refactor thứ đang chạy đúng.
- Viết theo style hiện có, kể cả khi mình thích cách khác.
- Thấy dead code không liên quan thì báo, không tự xoá.

Khi thay đổi của mình làm thừa ra thứ gì:

- Xoá import / biến / hàm mà chính thay đổi của mình làm không còn dùng.
- Không xoá dead code có từ trước, trừ khi được yêu cầu.

Phép thử: mỗi dòng thay đổi phải truy được về yêu cầu của người dùng.

### 4. Làm theo mục tiêu kiểm chứng được

**Đặt tiêu chí thành công. Lặp tới khi kiểm chứng xong.**

Đổi việc cần làm thành mục tiêu kiểm chứng được:

- "Thêm validate" → viết test cho input sai, rồi làm cho test pass.
- "Sửa bug" → viết test tái hiện bug, rồi làm cho test pass.
- "Refactor X" → test pass cả trước lẫn sau khi refactor.

Việc nhiều bước thì nêu kế hoạch ngắn:

```
1. [Bước] → kiểm chứng: [cách kiểm]
2. [Bước] → kiểm chứng: [cách kiểm]
3. [Bước] → kiểm chứng: [cách kiểm]
```
