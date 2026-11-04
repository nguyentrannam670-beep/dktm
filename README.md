# NHÀ THÔNG MINH ESP32 – WEB HTML + FIREBASE

Gói này được chuyển từ 2 file Python bạn cung cấp:

- `giao-diện.py`: giao diện CustomTkinter, đọc dữ liệu `DATA,TEMP=...,HUM=...,MQ=...,DIST=...,DOOR=...,FIRE=...,LIGHT=...,FAN=...` qua COM 115200 và gửi 4 lệnh `LIGHT_ON`, `LIGHT_OFF`, `FAN_ON`, `FAN_OFF`.
- `gki (1).py`: phần mềm MicroPython ESP32 điều khiển DHT22, MQ-2, HC-SR04, servo cửa, LED báo cháy, buzzer, đèn phòng và relay quạt.

Phiên bản web giữ các màn hình này và thêm đăng nhập Firebase, trạng thái ESP32 online/offline, nhật ký và chế độ xem thử dữ liệu giả lập. **Web chỉ hoạt động từ xa với ESP32 sau khi bạn nạp firmware Wi-Fi được cung cấp**; việc upload `index.html` đơn thuần KHÔNG tự làm ESP32 kết nối Firebase.

## Website đang triển khai

- Địa chỉ: **https://smart-room-4899a.web.app**. Màn hình đầu là đăng nhập; sau khi xác thực tài khoản quản trị mới hiện bảng điều khiển. Chế độ xem mẫu được đánh dấu và không gửi dữ liệu/lệnh thật.
- Firebase Web App, Email/Password Authentication, Realtime Database tại Singapore và quyền quản trị đã được cấu hình trong dự án `smart-room-4899a`. Mật khẩu tài khoản chỉ được bàn giao trong cuộc trò chuyện, không nằm trong mã nguồn hoặc thư mục public.
- Tài khoản Firebase riêng cho ESP32 và quyền gửi dữ liệu/nhật ký đã được cấu hình. `esp32/secrets.py` đã được tạo riêng, được bỏ qua khi commit và không xuất bản lên Hosting. Mạng Wi-Fi chọn bằng điện thoại; không cần sửa code khi đổi mạng.
- Khi cập nhật cấu hình cho dự án này, giữ nguyên UID quản trị đang có trong rules và `SMART_HOME_ADMIN_UID` trong `public/firebase-config.js`.

### Ngày giờ và nhật ký cửa

Đồng hồ hiển thị giờ, phút, giây; ngày, tháng, năm và thứ theo **giờ Việt Nam (UTC+7)**. Bảng **Lịch sử phát hiện & mở cửa** đọc tối đa 100 sự kiện mới nhất đã lưu tại `smartHome/events` trên Firebase, có bộ lọc theo loại và giữ lịch sử khi tải lại trang.

- `outside_detected`: HC-SR04 bắt đầu phát hiện người/vật phía ngoài. Đứng liên tục trước cảm biến chỉ tạo một sự kiện; rời đi rồi quay lại tạo sự kiện mới.
- `exit_requested`: ESP32 đã nhận và thực thi một yêu cầu mở cửa từ web. Không ghi sự kiện thành công chỉ vì trình duyệt vừa gửi lệnh.
- Mỗi sự kiện có `createdAt` do máy chủ Firebase cấp. Khi đồng bộ NTP được, `occurredAt` ghi thời điểm thiết bị phát hiện/nhận lệnh; web ưu tiên hiển thị thời điểm này. Nếu chưa đồng bộ được giờ thiết bị, web ghi rõ đang dùng thời điểm máy chủ nhận.
- ESP32 giữ tối đa 50 sự kiện chưa gửi trong RAM khi mất mạng và gửi lại theo mã sự kiện để tránh trùng. Hàng đợi này mất khi mất điện/khởi động lại; quá 50 sự kiện sẽ bỏ sự kiện cũ nhất chưa gửi. Các bản ghi đã lưu trên Firebase vẫn giữ nguyên.
- Chỉ quản trị được đọc lịch sử; tài khoản ESP32 được thêm bản ghi và đọc từng mã để kiểm tra gửi trùng, không được sửa/xóa lịch sử đã lưu. Nút xóa thông báo chỉ xóa thông báo phiên trình duyệt.

Với một HC-SR04, nhật ký **không xác nhận người đã bước qua cửa, danh tính hay hướng vào/ra**. Các dòng chỉ mô tả phát hiện ở vùng ngoài và yêu cầu mở từ web. Muốn xác định hướng đi cần bổ sung cảm biến và logic theo dõi lượt qua cửa.

## 1. Cấu trúc thư mục

```text
nha_thong_minh_firebase/
├── public/
│   ├── index.html              # Giao diện web (HTML)
│   ├── styles.css              # Giao diện xanh xám, responsive
│   ├── app.js                  # Xử lý Firebase và các nút điều khiển
│   └── firebase-config.js      # Dán cấu hình Web App Firebase
├── firebase.json               # Cấu hình Firebase Hosting + Database Rules
├── database.rules.json         # Phân quyền bảo vệ dữ liệu
├── esp32/
│   ├── main.py                 # Firmware MicroPython có kết nối Firebase
│   ├── door_control.py         # Cửa tự động + xử lý yêu cầu mở cửa một lần
│   ├── wifi_manager.py         # Trang cài Wi-Fi trên ESP32, lưu mạng và tự kết nối
│   ├── requests.py             # Thư viện HTTP MicroPython chính thức, có timeout
│   └── secrets_example.py      # Mẫu thông tin Wi-Fi/Firebase của ESP32
└── README.md
```

## 2. Tạo dự án Firebase

1. Mở [Firebase Console](https://console.firebase.google.com/) → **Add project** → tạo dự án.
2. Trong **Build → Realtime Database**, tạo cơ sở dữ liệu và ghi nhớ **Database URL** (ví dụ `https://ten-du-an-default-rtdb.asia-southeast1.firebasedatabase.app`). Chọn chế độ khóa ban đầu (không mở public).
3. Trong **Build → Authentication → Sign-in method**, bật **Email/Password**.
4. Trong **Authentication → Users**, tạo **2 tài khoản Email/Password** khác nhau:
   - Tài khoản **quản trị** để đăng nhập web.
   - Tài khoản **thiết bị** cho ESP32 (nạp trong `esp32/secrets.py`).
5. Sao chép **User UID** của từng tài khoản từ trang Users.
6. Tại **Project settings → Your apps**, nhấn biểu tượng **Web (</>)**, đăng ký Web app và lấy đoạn `firebaseConfig`.

## 3. Điền cấu hình

- Mở `public/firebase-config.js`, thay các giá trị `apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId` bằng cấu hình Firebase dự án của bạn.
- Mở `database.rules.json`:
  - Thay **THAY_ADMIN_UID** bằng UID tài khoản quản trị.
  - Thay **THAY_DEVICE_UID** bằng UID tài khoản ESP32.
- Quy tắc đã phân quyền: chỉ **admin** được đọc dữ liệu thiết bị và viết lệnh; chỉ **ESP32** được ghi dữ liệu đo và đọc lệnh. Các đường dẫn khác bị khóa.
- **Không dùng chế độ `.read: true` / `.write: true` cho toàn database.**

> Lưu ý: `apiKey` trong Web App là thông tin cấu hình công khai, không phải mật khẩu. Không đặt **mật khẩu người dùng**, mật khẩu **Wi-Fi** hoặc **tài khoản thiết bị** trong thư mục `public/`.

## 4. Đưa giao diện lên Firebase Hosting

Trên Windows, cài **Node.js** bản LTS và mở **Terminal / PowerShell** tại thư mục `nha_thong_minh_firebase`.

```bash
npm install -g firebase-tools
firebase login
firebase deploy --project TEN_PROJECT_ID --only hosting,database
```

Đổi `TEN_PROJECT_ID` thành **Project ID** bạn tạo ở Firebase Console. Lệnh `firebase deploy` ở trên áp dụng cả giao diện web lẫn **Realtime Database Rules**. Sau khi triển khai xong, đường dẫn thường là:

```text
https://TEN_PROJECT_ID.web.app
```

Bạn có thể truy cập trang đó bằng điện thoại hoặc máy tính. Trước khi ESP32 gửi dữ liệu thật, chọn **Xem giao diện mẫu (dữ liệu giả lập)** để thử bố cục và nút bấm. Chế độ mẫu chỉ cập nhật dữ liệu trong trình duyệt, **không điều khiển phần cứng**.

Nếu cần thử nhanh trên máy tính, mở terminal từ thư mục gốc và chạy:

```bash
python -m http.server 8000 --directory public
```

Mở `http://localhost:8000`. Không nên chạy trực tiếp `file:///.../index.html` để kiểm thử Firebase module.

## 5. Cài chương trình ESP32 qua Thonny

1. Cài bản MicroPython hiện hành phù hợp ESP32 và chọn trình thông dịch ESP32 trong Thonny.
2. Dùng **file `esp32/secrets.py` đã chuẩn bị sẵn**. File có tài khoản thiết bị và mật khẩu Wi-Fi cài đặt riêng. Để `WIFI_SSID` và `WIFI_PASSWORD` trống để chọn mạng bằng điện thoại. Không thay bằng mật khẩu đăng nhập web và không chép file này vào `public/`.
3. Lưu **5 file** vào bộ nhớ trong ESP32, cùng thư mục gốc: `main.py`, `door_control.py`, `wifi_manager.py`, `requests.py`, `secrets.py`. Giữ kèm `REQUESTS_LICENSE.txt` của thư viện HTTP. Chọn lưu vào **MicroPython device**, không chỉ lưu trên máy tính hoặc chạy F5 tạm thời.
4. Reset/bật lại ESP32. Dùng điện thoại kết nối Wi-Fi **SmartHome-Setup** bằng `SETUP_AP_PASSWORD` trong `secrets.py`. Nếu điện thoại báo không có Internet, chọn tiếp tục kết nối.
5. Mở **http://192.168.4.1**, nhập tên/mật khẩu Wi-Fi **2.4 GHz có Internet** hoặc điểm phát sóng điện thoại rồi lưu. ESP32 lưu mạng vào `wifi.json` trên board; không cần nạp lại code mỗi khi đổi mạng. Mật khẩu mạng cũ không hiện trên trang cài đặt.
6. Chuyển điện thoại về mạng Internet thường/4G/5G, mở **https://smart-room-4899a.web.app** và đăng nhập. Đợi **ESP32 TRỰC TUYẾN** để xem dữ liệu và điều khiển cửa/đèn/quạt.
7. Có thể rút dây nối máy tính và cấp nguồn bằng sạc USB phù hợp. ESP32 tự chạy `main.py` khi bật nguồn, tự kết nối Wi-Fi đã lưu và gửi Firebase; không cần mở Thonny, trình duyệt hay chương trình Python trên máy tính.

Khi tới nơi có Wi-Fi khác, nếu không nối được mạng cũ sau khoảng 20 giây hoặc không liên lạc được Firebase khoảng 60 giây, ESP32 bật lại **SmartHome-Setup** để đổi mạng bằng điện thoại ở gần thiết bị. Trang cài đặt tắt sau khi liên lạc Firebase thành công và đủ thời gian hoàn tất cấu hình. ESP32 cần có Internet; bản này không tự dùng SIM/4G và không hỗ trợ mạng doanh nghiệp hoặc mạng yêu cầu đăng nhập qua trang web. Wi-Fi cài đặt chỉ phục vụ cấu hình, không phải Internet cho điện thoại.

Thư viện `requests.py` được lấy từ [micropython-lib](https://github.com/micropython/micropython-lib/tree/master/python-ecosys/requests), giấy phép trong `esp32/REQUESTS_LICENSE.txt`. Các yêu cầu HTTP đặt timeout 5 giây; DNS/TLS và NTP vẫn có thể làm vòng lặp bị trễ trong điều kiện mạng kém.

**Chú ý về cổng GPIO (giữ theo file gốc):** HC-SR04 `TRIG=5`, `ECHO=18`; servo `13`; DHT22 `4`; MQ-2 ADC `34`; buzzer `23`; LED báo cháy `2`; LED đèn phòng `25`; relay quạt `26`. Chân ECHO 5V của HC-SR04 phải được hạ về mức an toàn 3,3V trước khi nối ESP32. Đầu ra ADC đến ESP32 không được vượt 3,3V.

### Cửa tự động phía ngoài, mở thủ công khi đi ra

Giữ nguyên bộ linh kiện có **1 HC-SR04** và **1 servo SG90**, không cần thêm cảm biến để dùng nút trên web:

- Đặt HC-SR04 hướng ra vùng tiếp cận phía ngoài. ESP32 mở servo ở góc 90° khi đo được vật trong khoảng **2–5 cm**, và giữ mở trong lúc còn phát hiện vật.
- Ở phía trong, mở web, đăng nhập, bấm **MỞ CỬA ĐỂ RA NGOÀI**. Nút chỉ khả dụng khi ESP32 online và đã đồng bộ lệnh. Web chờ ESP32 xác nhận, không tự đổi trạng thái cửa thành đã mở ngay khi gửi lệnh.
- Khi cảm biến ngoài không còn phát hiện vật gần cửa, chờ **5 giây** rồi đưa servo về góc 0°. Phát hiện vật trở lại sẽ hủy thời gian chờ. Bấm mở thêm một lần cũng bắt đầu lại thời gian giữ mở.
- Cảm biến lỗi/không có tín hiệu không được coi là vùng trống: nếu cửa đang mở thì giữ mở. Sau khi đọc lại được khoảng cách hợp lệ, bắt đầu lại thời gian chờ. Bố trí mặt nền phản hồi trong phạm vi 4 m để HC-SR04 có số đo hợp lệ khi vùng gần cửa trống.
- Cảnh báo cháy tiếp tục ưu tiên giữ cửa mở. Khi hết cảnh báo, bắt đầu lại thời gian chờ thay vì đóng ngay.
- Chỉnh `DISTANCE_LIMIT` và `DOOR_OPEN_TIME` trong `esp32/main.py` cho mô hình thực tế. Ngưỡng hiện tại là 5 cm, không phải kết quả nhận diện con người. Cần nạp firmware mới để thay đổi ngưỡng trên thiết bị thật.

Một HC-SR04 không phân biệt người với đồ vật và không theo dõi độc lập cả trong lẫn ngoài. **Phía trong chưa có cảm biến chống kẹt**; SG90 và chương trình này phục vụ mô hình thử nghiệm. Trạng thái `DOOR` là lệnh servo, chưa có công tắc hành trình xác nhận vị trí cửa. Các yêu cầu HTTPS hiện chạy cùng vòng lặp nên mạng chậm có thể làm việc phát hiện và đóng/mở bị trễ.

Nút mở gửi `desired.DOOR_OPEN_REQUEST` là mã yêu cầu mới cho mỗi lần bấm. ESP32 xử lý mỗi mã một lần; lần đồng bộ đầu sau khởi động/kết nối lại bỏ qua mã cũ để tránh tự mở lại cửa. `telemetry.DOOR_REQUEST_ID` xác nhận mã đã thực thi, `DOOR_MANUAL_READY` cho biết thiết bị đã sẵn sàng. Cần cập nhật Database Rules sau khi điền đúng UID để cho phép trường `DOOR_OPEN_REQUEST`; chỉ triển khai Hosting sẽ chưa điều khiển được cửa thật.

Web hiện tại: **https://smart-room-4899a.web.app**. Chọn **Xem giao diện mẫu** để thử nút mở cửa, sau đó bật/tắt **Mô phỏng có người phía ngoài** để kiểm tra tự mở, giữ mở và tự đóng. Chế độ mẫu không gửi lệnh đến ESP32.

## 6. Dữ liệu hoạt động thế nào?

```text
ESP32 → Wi-Fi → Firebase Realtime Database → Website
           telemetry (cập nhật khoảng 2,5 giây)

Website → Firebase Realtime Database → Wi-Fi → ESP32
           desired: LIGHT, FAN, DOOR_OPEN_REQUEST (ESP32 kiểm tra khoảng 1,4 giây)
```

Cấu trúc dữ liệu trên Firebase:

```json
{
  "smartHome": {
    "telemetry": {
      "TEMP": 28.5,
      "HUM": 65.2,
      "MQ": 2730,
      "DIST": 16.0,
      "DOOR": 0,
      "DOOR_PRESENCE": 0,
      "DOOR_REASON": "idle",
      "DOOR_LIMIT_CM": 5,
      "DOOR_HOLD_MS": 5000,
      "DOOR_MANUAL_READY": true,
      "FIRE": 0,
      "LIGHT": 1,
      "FAN": 0,
      "updatedAt": 1793700000000
    },
    "desired": {
      "LIGHT": 1,
      "FAN": 0,
      "DOOR_OPEN_REQUEST": "ma-yeu-cau-moi-cho-moi-lan-bam",
      "updatedAt": 1793700000000
    }
  }
}
```

`updatedAt` là timestamp máy chủ Firebase (millisecond), số minh họa bên trên không phải dữ liệu đo thực tế. Web xem ESP32 online nếu timestamp đo mới trong khoảng **15 giây**. Khi bấm nút, web **ghi yêu cầu** vào `desired`; ESP32 mới là thiết bị xác nhận bằng cách cập nhật `telemetry.LIGHT` / `telemetry.FAN`. Không đánh đồng gửi lệnh với bật/tắt thành công.

## 7. Những điều cần kiểm tra trước khi sử dụng thực tế

- **MQ-2:** file `gki (1).py` của bạn kích hoạt cảnh báo khi `mq_value <= 2000` (không phải `>= 2000`). Chương trình mới **giữ đúng chiều so sánh đó**. Phải đo, hiệu chuẩn và chỉnh `FIRE_THRESHOLD`, `FIRE_TRIGGER_WHEN_BELOW` phù hợp mạch MQ-2 thực tế. Chỉ dùng cho đồ án hoặc thử nghiệm; **không dùng thay hệ thống phòng cháy chữa cháy đạt chuẩn**.
- **Relay quạt:** trong mã gốc có hai khai báo `RELAY_ACTIVE_LOW` mâu thuẫn, nhưng hàm `set_fan()` thực sự **bật bằng GPIO=0 và tắt bằng GPIO=1**. Mã mới dùng `RELAY_ACTIVE_LOW = True`. Nếu relay của bạn kích mức HIGH, hãy đổi thành `False`.
- **Khoảng cách:** `DIST=-1` nghĩa là cảm biến không trả tín hiệu. Mã web mới không coi `3.0 cm` là trống (đo được 3 cm là một giá trị hợp lệ).
- **Cảnh báo và cửa:** cửa giữ mở khi có vật gần cảm biến ngoài, có lệnh mở từ web hoặc báo cháy; chỉ đóng sau thời gian chờ khi cảm biến trả số đo vùng trống hợp lệ. Yêu cầu mạng HTTPS có thể làm vòng lặp MicroPython chậm khi mạng kém. Đây là phiên bản cho **đồ án/thử nghiệm**, không phải hệ thống an toàn thời gian thực.
- **An toàn Firebase:** xác thực 2 tài khoản riêng, không chia sẻ mật khẩu thiết bị, không xuất bản `secrets.py`, không tạo rule public, không phát tán UID nếu không cần thiết.

## 8. Khắc phục sự cố nhanh

- **Web chỉ hiện chế độ mẫu:** chưa điền `public/firebase-config.js` hoặc chưa upload lại Hosting.
- **Firebase báo permission-denied:** kiểm tra đúng UID 2 tài khoản trong `database.rules.json` và deploy database rules.
- **ESP32 ngoại tuyến:** kiểm tra Wi-Fi, `DEVICE_EMAIL`/password, URL Realtime Database đúng khu vực, Serial log. Đừng nhầm **Realtime Database** với **Cloud Firestore**.
- **ESP32 online nhưng đèn/quạt không chạy:** kiểm tra dây GPIO, mức kích relay, chân LED và việc firmware có đang nhận `desired` không.
- **Thấy nhiều lỗi HTTP/SSL/MemoryError trên ESP32:** firmware MicroPython/HTTP client hoặc RAM có thể không đủ cho các kết nối HTTPS thường xuyên; giảm tần suất đọc/ghi hoặc dùng một bridge/backend trung gian phù hợp.

## Tài liệu chính thức

- Firebase Hosting: https://firebase.google.com/docs/hosting/quickstart
- Firebase Web SDK: https://firebase.google.com/docs/web/setup
- Realtime Database web: https://firebase.google.com/docs/database/web/read-and-write
- Realtime Database Rules: https://firebase.google.com/docs/database/security
- Firebase Auth REST: https://firebase.google.com/docs/reference/rest/auth
