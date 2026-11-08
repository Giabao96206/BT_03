# Worker FastSD CPU trên máy thành viên

## Kiến trúc

`db1` giữ PostgreSQL, Redis, API, ảnh PNG và giao diện. Máy thành viên chỉ chạy image `bt03-ukiyoe/fastsd-remote-worker:1`. Worker kết nối đến API của `db1` qua Tailscale, xác thực bằng token riêng, nhận một job khi rảnh, chạy FastSD CPU, rồi tải PNG lên API. API ghi ảnh và metadata vào PostgreSQL. Không cấp cổng hay mật khẩu PostgreSQL/Redis cho thành viên.

Một tìm kiếm chưa có ảnh tạo job ưu tiên cao. Worker 1.1 tại `db1` và các worker từ xa cùng tranh nhận job bằng cập nhật trạng thái có điều kiện; chỉ một worker nhận được. Scheduler tiếp tục tạo job nền. Mỗi worker từ xa lấy job mới sau khi xong job trước. Khi mất heartbeat quá 90 giây, job đang tạo được trả lại hàng đợi. Ảnh và trạng thái worker xuất hiện tại `/monitoring` và `/api/workers`.

## Chuẩn bị trên `db1`

```bash
cd '/home/giabaovip/AI Gen Image/bt03-ukiyoe'
./scripts/setup-env.sh
docker compose build migrate api worker-11
docker compose up --no-deps --force-recreate migrate
docker compose stop worker-12
docker compose -f docker-compose.yml -f docker-compose.remote-api.yml up -d --no-deps api worker-11
curl -f http://127.0.0.1:3101/api/health
```

File `docker-compose.remote-api.yml` mở thêm cổng `3102` **chỉ trên IP Tailscale** của `db1`; cổng API cũ `127.0.0.1:3101` vẫn có. Mặc định IP là `100.72.133.40`. Nếu IP Tailscale thay đổi, đặt `BT03_TAILSCALE_IP` trong `.env` trước khi chạy Compose. Dùng `tailscale ip -4` để kiểm tra. Máy thành viên phải vào cùng tailnet và ping được IP đó. Không mở cổng PostgreSQL/Redis ra mạng.

## Cấp token cho từng máy

Trên `db1`, tạo token riêng cho từng worker. Ví dụ ba máy thành viên:

```bash
./scripts/worker-token.sh 1.2
./scripts/worker-token.sh 1.3
./scripts/worker-token.sh 1.4
```

Gửi từng token qua kênh riêng. Mỗi máy dùng `WORKER_ID` và token tương ứng. Không đưa token, `.env` của `db1` hoặc `REMOTE_WORKER_SECRET` lên GitHub.

## Cài từ GitHub trên máy thành viên

Máy thành viên cần Docker, Docker Compose, Git và Tailscale. Sau khi vào cùng tailnet với `db1`:

```bash
git clone https://github.com/Giabao96206/BT_03.git
cd BT_03
docker build -f infrastructure/docker/remote-worker.Dockerfile \
  -t bt03-ukiyoe/fastsd-remote-worker:1 .
cp .env.remote.example .env.remote
# Sửa WORKER_ID, WORKER_TOKEN, CENTRAL_API_URL và MEMBER_NAME trong .env.remote
chmod 600 .env.remote
docker compose -f docker-compose.remote-worker.yml up -d
docker compose -f docker-compose.remote-worker.yml logs -f remote-worker
```

Ví dụ máy thứ nhất dùng `WORKER_ID=1.2`, máy thứ hai dùng `1.3`, máy thứ ba dùng `1.4`. `CENTRAL_API_URL` của tất cả máy là `http://100.72.133.40:3102`.

Nếu muốn chuyển image đã build sẵn thay vì build trên từng máy, chạy `./scripts/package-remote-worker.sh` trên `db1`, rồi chuyển `dist/fastsd-remote-worker-1.tar.gz` trực tiếp. Gói tar không lưu trong Git vì vượt giới hạn kích thước file thông thường của GitHub.

Lần build đầu tải thư viện Python; lần chạy đầu tải checkpoint SD 1.5 và LCM-LoRA về volume `bt03_model_cache`. Vì vậy máy cần Internet, vài GB dung lượng và thời gian tải. Sau đó worker mới đăng ký và nhận job. Mỗi máy nên có ít nhất 8 GB RAM và 10 GB trống cho Docker/model; giới hạn Compose hiện là 4 CPU, 6 GB RAM. Có thể đặt `MODEL_CHECKPOINT` thành một checkpoint SD 1.5 tương thích khác, ví dụ `Lykon/dreamshaper-8`; hãy thử một ảnh trước khi cho chạy liên tục. Worker 1.2 trên `db1` được dừng để ID này chỉ thuộc máy từ xa.

Trên `db1`, đặt `BT03_REMOTE_API_ENABLED=true` và `BT03_TAILSCALE_IP=100.72.133.40` trong `.env` để các lần chạy `./scripts/start-all.sh` sau vẫn giữ cổng 3102. Sau khi khởi động lại Ubuntu, kiểm tra `curl http://100.72.133.40:3102/api/health`; nếu Tailscale lên chậm hơn Docker, chạy lại `./scripts/start-all.sh`. Không cần chạy worker từ xa trên `db1` sau bước thử nghiệm.

## Kiểm tra

Trên `db1`, xem `http://127.0.0.1:3100/monitoring` hoặc:

```bash
curl -s http://127.0.0.1:3101/api/workers
curl -sG --data-urlencode 'q=red fox beside a river' http://127.0.0.1:3101/api/images/search
```

Sau khi job hoàn tất, `workerId` của ảnh cho biết máy đã tạo. Worker nhận việc qua polling 5 giây, heartbeat 10 giây. Nếu máy thành viên tắt, Docker `restart: unless-stopped` tự bật worker khi Docker khởi động; nếu mất kết nối lâu, job được giao lại. Máy `db1` cần đang chạy để nhận ảnh. Trường hợp nhiều worker đang rảnh, worker lấy job đầu tiên; chưa có thuật toán chọn worker theo tải hay phần trăm tiến độ trong một ảnh.
