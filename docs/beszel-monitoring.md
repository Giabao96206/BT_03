# Giám sát máy và worker với Beszel

Có hai nguồn số liệu:

- `http://100.125.161.12:3100/monitoring`: job đang xử lý, mô tả ảnh, thời gian ở trạng thái hiện tại, ảnh đã sinh, ảnh trong 24 giờ, lỗi, ảnh gần nhất và heartbeat. Dữ liệu lấy từ PostgreSQL, dùng được với worker v2/v3.
- `http://100.125.161.12:8090`: Beszel Hub, đăng nhập riêng để xem CPU, RAM, swap, ổ đĩa, lưu lượng mạng, container và lịch sử. Mỗi máy phải có Beszel Agent; trạng thái của agent khác với heartbeat của worker AI.

Không suy đoán % diffusion từ thời gian chạy. Worker v2/v3 chưa gửi số bước thực tế. Tên máy trong Beszel nên dùng `db1 / worker 1.1`, `worker 1.2`, `worker 1.3`, `worker 1.5` để đối chiếu với trang ứng dụng.

Trang `/monitoring` hiển thị đủ danh sách nhóm `1.1` đến `1.5`, sắp theo ID. Máy chưa có bản ghi đăng ký được ghi rõ `Chưa kết nối lần đầu`, không tạo heartbeat hoặc thông số máy giả. Có thể đổi danh sách bằng `MONITORING_WORKER_IDS` trong `.env` của API; các worker đăng ký thêm vẫn được hiển thị. Beszel chỉ có biểu đồ sau khi agent của từng máy kết nối, không tự có số liệu chỉ vì có thẻ trong trang giám sát.

## Server db1

```bash
python3 scripts/setup-beszel.py
sudo docker compose -f docker-compose.beszel.yml up -d
python3 scripts/register-beszel-agent.py
sudo docker compose -f docker-compose.beszel-agent.yml up -d
```

Hub bind localhost và IP Tailscale, có volume dữ liệu riêng `bt03-monitoring_beszel_data`, giới hạn RAM 256 MB. Agent giới hạn RAM 128 MB, dùng network host để đọc số liệu mạng. Kết nối chính là WebSocket từ agent tới Hub; không cần mở cổng agent ra ngoài. Docker socket được mount để agent đọc số liệu container; chỉ cài trên máy đã đồng ý giám sát. Hub tắt tính năng xem inspect/log container (`CONTAINER_DETAILS=false`).

Đọc tài khoản đăng nhập trong `.env.beszel` trên server (file 600). Email khởi tạo: `admin@bt03.local`; password được sinh ngẫu nhiên, không đưa lên Git. Có thể đổi trong Beszel sau khi đăng nhập. Không bật `AUTO_LOGIN`.

```bash
cat .env.beszel
```

## Thêm một máy worker từ xa

Máy remote cần Tailscale vào tailnet cá nhân, Docker và Compose. Beszel là container riêng nên không cần đổi image AI, xóa cache hay tải lại model.

1. Chủ server mở Beszel, chọn **Add System**; đặt tên theo worker và Host/IP bằng IP Tailscale của máy đó, port 45876. Sao chép public key (`KEY`) và agent token (`TOKEN`) mà Hub hiển thị. Lưu hệ thống trong Hub.
2. Trên máy thành viên, tải/copy `docker-compose.beszel-agent.yml` và `.env.beszel-agent.example` từ repository. Có thể tải riêng hai file để giữ nguyên Compose v2 đang dùng:

```bash
curl -fL https://raw.githubusercontent.com/Giabao96206/BT_03/main/docker-compose.beszel-agent.yml -o docker-compose.beszel-agent.yml
curl -fL https://raw.githubusercontent.com/Giabao96206/BT_03/main/.env.beszel-agent.example -o .env.beszel-agent.example
cp .env.beszel-agent.example .env.beszel-agent
nano .env.beszel-agent
```

Điền đúng ba biến, `KEY` có dấu ngoặc kép do chứa khoảng trắng:

```dotenv
HUB_URL=http://100.125.161.12:8090
KEY="ssh-ed25519 ...public key do Hub cap..."
TOKEN=agent-token-do-Hub-cap
```

Token Beszel khác WORKER_TOKEN của AI; không đổi token AI. Không gửi file agent lên Git. Mỗi máy có agent token riêng. Kiểm tra và khởi động:

```bash
chmod 600 .env.beszel-agent
curl -f --connect-timeout 10 http://100.125.161.12:8090/api/health
sudo docker compose -f docker-compose.beszel-agent.yml up -d
sudo docker compose -f docker-compose.beszel-agent.yml logs --tail 30 beszel-agent
```

Chủ server cũng có thể tạo file agent trước bằng API của Hub (chạy trên db1):

```bash
python3 scripts/register-beszel-agent.py --name 'worker 1.5' --host '<IP_TAILSCALE_MAY_CHUNG>' --hub-url http://100.125.161.12:8090 --output .env.beszel-agent-1.5
```

Gửi riêng file này cho đúng thành viên, lưu thành `.env.beszel-agent` trên máy đó. Script bảo toàn file đã tồn tại và không in token ra log. Không đăng ký lại cùng token trên hai máy do Beszel khóa fingerprint theo máy.

## Wi-Fi và máy ảo

Beszel 0.21.2 có thể đọc RSSI/SSID Wi-Fi trên Linux nếu agent thấy card Wi-Fi thật và có NET_ADMIN. Với máy Linux vật lý, dùng thêm file override:

```bash
sudo docker compose -f docker-compose.beszel-agent.yml -f docker-compose.beszel-wifi.yml up -d
```

Ubuntu trong VMware thường chỉ thấy card Ethernet ảo. Khi đó vẫn đọc được byte gửi/nhận và CPU/RAM của VM, nhưng không thấy sóng Wi-Fi, CPU/RAM toàn máy Windows hay các card nằm ngoài VM. Muốn đo phần cứng Windows phải cài Beszel Agent cho Windows trên host theo hướng dẫn chính thức. Lưu lượng mạng không phải phép đo tốc độ Internet tối đa.

## Khởi động lại và đổi IP

Hai stack Beszel có restart policy riêng. Sau khi cài, Docker khởi động sẽ bật lại container. `start-all.sh` chỉ quản lý stack AI; lần cài Beszel đầu dùng các lệnh ở trên. Không dùng `down -v` khi chỉ nâng cấp. Khi IP server đổi, cập nhật `APP_URL` bằng BT03_TAILSCALE_IP trên server, `BESZEL_URL` của API nếu đã cấu hình, và `HUB_URL` trên agent rồi tạo lại container tương ứng.

## Nguồn chính thức

- https://beszel.dev/guide/hub-installation
- https://beszel.dev/guide/agent-installation
- https://beszel.dev/guide/wifi
- https://beszel.dev/guide/security

## Tự sinh ảnh và phục hồi job

Scheduler kiểm tra mỗi 10 giây và tạo đủ job cho số worker online trong 90 giây gần nhất, cộng một job dự phòng. `MAX_BACKGROUND_QUEUE` là mức tối thiểu. Worker remote đang kết nối tự nhận job mới qua API; không cần tải lại model. Nếu đã bấm tạm dừng scheduler, cần bấm tiếp tục trên trang giám sát.

API kiểm tra mỗi 30 giây các job local bị bỏ dở trên 2 phút, chỉ phục hồi khi không còn worker sở hữu và BullMQ không đang xử lý. PNG chưa ghi database được giữ trong `storage/images/.recovered/` trước khi chạy lại. Khi khởi động, worker local giải phóng quyền sở hữu của tiến trình cũ. Job và ảnh đã ghi database được giữ để kiểm tra nếu phát hiện trạng thái bất nhất.
