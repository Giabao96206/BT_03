# Worker FastSD CPU trên máy thành viên

## Kiến trúc

`db1` giữ PostgreSQL, Redis, API, ảnh PNG và giao diện. Máy thành viên chỉ chạy image `bt03-ukiyoe/fastsd-remote-worker:3`. Worker kết nối đến API của `db1` qua Tailscale, xác thực bằng token riêng, nhận một job khi rảnh, chạy FastSD CPU, rồi tải PNG lên API. API ghi ảnh và metadata vào PostgreSQL. Không cấp cổng hay mật khẩu PostgreSQL/Redis cho thành viên.

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

File `docker-compose.remote-api.yml` mở thêm cổng `3102` **chỉ trên IP Tailscale** của `db1`; cổng API cũ `127.0.0.1:3101` vẫn có. Mặc định IP là `100.125.161.12`. Nếu IP Tailscale thay đổi, đặt `BT03_TAILSCALE_IP` trong `.env` trước khi chạy Compose. Dùng `tailscale ip -4` để kiểm tra. Máy thành viên phải vào cùng tailnet và ping được IP đó. Không mở cổng PostgreSQL/Redis ra mạng.

## Đổi kết nối sang tailnet cá nhân

Server `db1` hiện dùng IP `100.125.161.12`. Máy thành viên cần đăng nhập vào tailnet cá nhân được chủ server mời và được duyệt nếu có yêu cầu. Chỉ đổi IP trong file cấu hình sẽ không giúp máy còn ở tailnet trường kết nối được.

Với worker đã cài (v2 hoặc v3), chạy trong thư mục `BT_03` trên máy thành viên:

```bash
tailscale ping 100.125.161.12
curl --connect-timeout 10 -f http://100.125.161.12:3102/api/health
sed -i 's|^CENTRAL_API_URL=.*|CENTRAL_API_URL=http://100.125.161.12:3102|' .env.remote
sudo docker compose -f docker-compose.remote-worker.yml up -d --no-deps --force-recreate --pull never remote-worker
sudo docker compose -f docker-compose.remote-worker.yml logs -f remote-worker
```

Chỉ khởi động lại worker khi kiểm tra health trả về `status: ok`. Giữ nguyên ID, token, phiên bản image và volume cache model; không cần tải lại image/model. Nếu đang chạy v2 thì giữ `CPU_THREADS=4`. `git pull` không tự sửa file `.env.remote` đã có, nên vẫn cần lệnh đổi `CENTRAL_API_URL` ở trên.

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
mkdir -p dist
curl -fL -o dist/fastsd-remote-worker-3.tar.gz \
  https://github.com/Giabao96206/BT_03/releases/download/remote-worker-v3/fastsd-remote-worker-3.tar.gz
curl -fL -o dist/fastsd-remote-worker-3.tar.gz.sha256 \
  https://github.com/Giabao96206/BT_03/releases/download/remote-worker-v3/fastsd-remote-worker-3.tar.gz.sha256
sha256sum -c dist/fastsd-remote-worker-3.tar.gz.sha256
docker load -i dist/fastsd-remote-worker-3.tar.gz
cp .env.remote.example .env.remote
# Sửa WORKER_ID, WORKER_TOKEN, CENTRAL_API_URL và MEMBER_NAME trong .env.remote
chmod 600 .env.remote
docker compose -f docker-compose.remote-worker.yml up -d
docker compose -f docker-compose.remote-worker.yml logs -f remote-worker
```

Nếu không muốn tải image build sẵn hoặc máy không phải `linux/amd64`, build image từ mã nguồn vừa clone:

```bash
docker build -f infrastructure/docker/remote-worker.Dockerfile \
  -t bt03-ukiyoe/fastsd-remote-worker:3 .
cp .env.remote.example .env.remote
# Sửa WORKER_ID, WORKER_TOKEN, CENTRAL_API_URL và MEMBER_NAME trong .env.remote
chmod 600 .env.remote
docker compose -f docker-compose.remote-worker.yml up -d
docker compose -f docker-compose.remote-worker.yml logs -f remote-worker
```

Ví dụ máy thứ nhất dùng `WORKER_ID=1.2`, máy thứ hai dùng `1.3`, máy thứ ba dùng `1.4`. `CENTRAL_API_URL` của tất cả máy là `http://100.125.161.12:3102`.

Gói tar được lưu dưới GitHub Release `remote-worker-v3` vì vượt giới hạn kích thước file của commit Git thông thường. Nếu cần tạo lại, chạy `./scripts/package-remote-worker.sh` trên `db1` rồi cập nhật Release.

Worker v3 chỉ tải 13 file Diffusers cần thiết của SD 1.5 (3,974 GiB) và một file LCM-LoRA (0,125 GiB), tổng cache model khoảng 4,1 GiB. Style LoRA khoảng 19 MB đã nằm trong image. Nó không tải các checkpoint `.ckpt`, trọng số `.bin`, Flax, safety checker không dùng hoặc các bản checkpoint gốc trùng lặp. Lần build đầu tải thư viện Python; lần chạy đầu tải model về volume `bt03_model_cache`. Sau đó worker mới đăng ký và nhận job. Mỗi máy nên có ít nhất 8 GB RAM và 10 GB trống cho Docker/model.

`CPU_THREADS=auto` là mặc định. Worker tự đọc số CPU hệ điều hành cho phép và quota CPU của Docker. Với máy có tối đa 4 CPU, worker dùng toàn bộ; với máy lớn hơn, worker dùng tối đa 6 luồng vì benchmark SD 1.5 trên `db1` cho thấy 6 luồng nhanh hơn 8. Đặt `CPU_THREADS=max` để ép dùng toàn bộ CPU khả dụng, hoặc đặt một số nguyên như `CPU_THREADS=4` để giới hạn. Log của mỗi lượt sinh ảnh có sự kiện `inference-config` và trường `cpuThreads` để kiểm tra số luồng thực tế.

## Nâng cấp máy đã chạy worker v1

Trên máy thành viên, dừng worker và xóa volume cache model cũ để giải phóng các checkpoint thừa. Lệnh `down -v` chỉ xóa container/network của remote worker và volume `bt03_model_cache`; model sẽ được tải lại, không ảnh hưởng ảnh hoặc database trên `db1`.

```bash
cd ~/BT_03
git pull
docker compose -f docker-compose.remote-worker.yml down -v
mkdir -p dist
curl -fL -o dist/fastsd-remote-worker-3.tar.gz \
  https://github.com/Giabao96206/BT_03/releases/download/remote-worker-v3/fastsd-remote-worker-3.tar.gz
curl -fL -o dist/fastsd-remote-worker-3.tar.gz.sha256 \
  https://github.com/Giabao96206/BT_03/releases/download/remote-worker-v3/fastsd-remote-worker-3.tar.gz.sha256
sha256sum -c dist/fastsd-remote-worker-3.tar.gz.sha256
docker load -i dist/fastsd-remote-worker-3.tar.gz
sed -i 's/^CPU_THREADS=.*/CPU_THREADS=auto/' .env.remote
docker compose -f docker-compose.remote-worker.yml up -d
docker compose -f docker-compose.remote-worker.yml logs -f remote-worker
```

## Nâng cấp máy đang chạy worker v2

Worker v3 dùng lại nguyên cache model của v2, token và `.env.remote`. Không chạy `down -v` ở bước này vì không cần tải lại model.

```bash
cd ~/BT_03
git pull
docker compose -f docker-compose.remote-worker.yml down
mkdir -p dist
curl -fL -o dist/fastsd-remote-worker-3.tar.gz \
  https://github.com/Giabao96206/BT_03/releases/download/remote-worker-v3/fastsd-remote-worker-3.tar.gz
curl -fL -o dist/fastsd-remote-worker-3.tar.gz.sha256 \
  https://github.com/Giabao96206/BT_03/releases/download/remote-worker-v3/fastsd-remote-worker-3.tar.gz.sha256
sha256sum -c dist/fastsd-remote-worker-3.tar.gz.sha256
docker load -i dist/fastsd-remote-worker-3.tar.gz
sed -i 's/^CPU_THREADS=.*/CPU_THREADS=auto/' .env.remote
docker compose -f docker-compose.remote-worker.yml up -d
docker compose -f docker-compose.remote-worker.yml logs -f remote-worker
```

Trên `db1`, đặt `BT03_REMOTE_API_ENABLED=true` và `BT03_TAILSCALE_IP=100.125.161.12` trong `.env` để các lần chạy `./scripts/start-all.sh` sau vẫn giữ cổng 3102. Sau khi khởi động lại Ubuntu, kiểm tra `curl http://100.125.161.12:3102/api/health`; nếu Tailscale lên chậm hơn Docker, chạy lại `./scripts/start-all.sh`. Không cần chạy worker từ xa trên `db1` sau bước thử nghiệm.

## Kiểm tra

Trên `db1`, xem `http://127.0.0.1:3100/monitoring` hoặc:

```bash
curl -s http://127.0.0.1:3101/api/workers
curl -sG --data-urlencode 'q=red fox beside a river' http://127.0.0.1:3101/api/images/search
```

Sau khi job hoàn tất, `workerId` của ảnh cho biết máy đã tạo. Worker nhận việc qua polling 5 giây, heartbeat 10 giây. Nếu máy thành viên tắt, Docker `restart: unless-stopped` tự bật worker khi Docker khởi động; nếu mất kết nối lâu, job được giao lại. Máy `db1` cần đang chạy để nhận ảnh. Trường hợp nhiều worker đang rảnh, worker lấy job đầu tiên; chưa có thuật toán chọn worker theo tải hay phần trăm tiến độ trong một ảnh.
