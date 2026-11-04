# Nạp một lần, dùng Wi-Fi ở nhiều nơi

Website đã online: **https://smart-room-4899a.web.app**.

1. Cắm USB, mở Thonny và cài/chọn MicroPython cho ESP32.
2. Lưu 5 file sau **vào thư mục gốc của ESP32** (MicroPython device):
   - `esp32/main.py`
   - `esp32/door_control.py`
   - `esp32/wifi_manager.py`
   - `esp32/requests.py`
   - `esp32/secrets.py` — đã có cấu hình Firebase riêng; không chia sẻ hoặc đưa lên web.
3. Reset ESP32. Điện thoại kết nối Wi-Fi **SmartHome-Setup**, dùng giá trị `SETUP_AP_PASSWORD` trong `secrets.py`.
4. Giữ kết nối dù điện thoại báo không có Internet. Mở **http://192.168.4.1** và nhập tên/mật khẩu Wi-Fi **2.4 GHz** có Internet hoặc hotspot điện thoại. Bấm lưu.
5. Điện thoại quay lại Wi-Fi thường/4G/5G và mở website. ESP32 tự gửi dữ liệu qua Firebase; máy tính không cần chạy để chuyển dữ liệu.
6. Rút khỏi máy tính và dùng sạc USB phù hợp để cấp nguồn. Lần bật sau ESP32 tự chạy và nhớ mạng đã lưu.

Đổi địa điểm: nếu không có mạng đã lưu, đợi khoảng 20 giây rồi kết nối lại **SmartHome-Setup** để chọn mạng mới. Không cần nạp lại chương trình. Với Wi-Fi có kết nối nhưng không vào được Firebase, điểm cài đặt sẽ mở lại sau khoảng 60 giây. Cần ở gần ESP32 để đổi mạng; xem dữ liệu trên website thì có thể ở bất cứ đâu có Internet.

Wi-Fi doanh nghiệp và Wi-Fi có trang đăng nhập chưa được hỗ trợ. Với hotspot điện thoại, chọn băng tần 2.4 GHz/chế độ tương thích. Nếu dùng chính một điện thoại để phát hotspot và cấu hình, thường cần thiết bị thứ hai để kết nối mạng cài đặt ESP32.

Code cửa hiện mở khi HC-SR04 đo được **2–5 cm**, giữ mở khi còn vật và chờ 5 giây vùng trống trước khi đóng. Phía trong dùng nút mở trên web; chưa có cảm biến vật cản phía trong.

Hướng dẫn đầy đủ và sơ đồ chân có trong `README.md`. Phần mềm đã được kiểm tra bằng mô phỏng; vẫn cần thử trên board và mô hình thực tế sau khi nạp.
