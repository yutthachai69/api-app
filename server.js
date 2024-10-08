const express = require('express');
const pool = require("./database");
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const port = 4000; // ประกาศตัวแปร port ที่นี่


// ตรวจสอบและสร้างโฟลเดอร์ 'uploads' หากไม่มี
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// ตรวจสอบ user token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // รับ token จาก header
  if (!token) return res.sendStatus(401); // ถ้าไม่มี token ส่ง status 401
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.sendStatus(403); // ถ้า token ไม่ถูกต้อง ส่ง status 403
    req.user = user; // เก็บข้อมูล user ไว้ใน req
    next(); // ดำเนินการต่อไป
  });
};

// ดึงข้อมูลผู้ใช้งานที่เข้าสู่ระบบ
app.get('/account', authenticateToken, async (req, res) => {
  try {
    const userid = req.user.id;
    const [results] = await pool.query("SELECT email, name, picture FROM users WHERE id = ?", [userid]);
    if (results.length === 0) {
      return res.status(404).json({ error: "ไม่พบผู้ใช้" });
    }
    res.json(results[0]); // ส่งข้อมูลผู้ใช้เป็น JSON
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "ผิดพลาด" });
  }
});

// ลงทะเบียนผู้ใช้
app.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const [result] = await pool.query('INSERT INTO users (email, password, name) VALUES (?, ?, ?)', [email, hashedPassword, name]);
    res.status(201).send('User registered');
  } catch (error) {
    res.status(500).send('Error registering user');
  }
});

// เข้าสู่ระบบผู้ใช้
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const [results] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const user = results[0];
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  if (await bcrypt.compare(password, user.password)) {
    const accessToken = jwt.sign({ id: user.id, email: user.email },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: '20h' }
    );
    return res.json({ token: accessToken });
  } else {
    return res.status(401).json({ message: 'Password incorrect' });
  }
});

// กำหนดโฟลเดอร์สำหรับเก็บรูป
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname)); // ตั้งชื่อไฟล์เป็น timestamp + นามสกุลไฟล์
  }
});

const upload = multer({ storage: storage });

// เปิดให้เข้าถึงไฟล์จากโฟลเดอร์ 'uploads'
app.use('/uploads', express.static('uploads'));

// แก้ไขข้อมูลบัญชีผู้ใช้งาน
app.put('/update-account', authenticateToken, upload.single('picture'), async (req, res) => {
  const { name, email } = req.body;
  const picturePath = req.file ? `uploads/${req.file.filename}` : null;
  try {
    const userid = req.user.id;
    let query = 'UPDATE users SET name = ?, email = ?';
    let params = [name, email];
    if (picturePath) {
      query += ', picture = ?'; // เพิ่ม field รูปภาพถ้ามีการอัปโหลด
      params.push(picturePath);
    }
    query += ' WHERE id = ?';
    params.push(userid);
    const [results] = await pool.query(query, params);
    if (results.affectedRows === 0) {
      return res.status(400).json({ error: "ไม่พบผู้ใช้" });
    }
    res.json({ message: "แก้ไขข้อมูลเรียบร้อย" });
  } catch (err) {
    console.log("Error", err);
    res.status(500).json({ error: "ผิดพลาด" });
  }
});
// ############# เพิ่มใน server.js ##############

// โพสบล็อกใหม่่
app.post('/create-post', authenticateToken, async (req, res) => {
  const { title, detail, category } = req.body;
  try {
      const userid = req.user.id; // ใช้ user id จาก JWT
      const [result] = await pool.query(
          'INSERT INTO blog (userid, title, detail, category) VALUES (?, ?, ?, ?)',
          [userid, title, detail, category]
      );
      res.status(201).json({ message: "โพสต์ถูกสร้างเรียบร้อย", postId: result.insertId });
  } catch (err) {
      res.status(500).json({ error: "ไม่สามารถสร้างโพสต์ได้" });
  }
});


// แสดงโพสทั้งหมดตาม user
app.get ('/read-post/' , authenticateToken, async (req, res) => {
  try {
      const userid = req.user.id;
      const [results] = await pool.query('SELECT * FROM blog WHERE userid = ?', [userid])
      if(results.length === 0) {
          return res.status(404).json({error : "ไม่พบบทความ"})
      }
      res.json(results)
  }catch(err) {
      console.log(err)
      res.status(500).json({ error: "ไม่สามารถดึงข้อมูลได้"})
  }
});

// ดึงข้อมูล blog ตาม id
app.get('/post/:blogid', async (req, res) => {
  const { blogid } = req.params; // ดึงค่า blogid จาก URL Parameters
  try {
      // คำสั่ง SQL สำหรับดึงข้อมูลบล็อกจากฐานข้อมูล
      const [result] = await pool.query('SELECT * FROM blog WHERE blogid = ?', [blogid]);
      // ตรวจสอบว่าพบบล็อกหรือไม่
      if (result.length === 0) {
          return res.status(404).json({ message: 'Blog not found' });
      }
      // ส่งข้อมูลบล็อกที่พบกลับไปยัง client
      return res.json(result[0]);
  } catch (err) {
      console.error("Error fetching blog data: ", err); // แสดงข้อผิดพลาดใน console
      return res.status(500).json({ message: 'Error fetching blog data', error: err });
  }
});

// ลบข้อมูล blog
app.delete('/post/:blogid', async (req, res) => {
  const { blogid } = req.params;
  try {
    const [result] = await pool.query('DELETE FROM blog WHERE blogid = ?', [blogid]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Blog not found' });
    }
    return res.json({ message: 'Blog deleted successfully' });
  } catch (err) {
    console.error("Error executing SQL: ", err); // ตรวจสอบข้อผิดพลาด SQL
    return res.status(500).json({ message: 'Error deleting the blog', error: err });
  }
});

// แก้ไขข้อมูล blog
app.put('/post/:blogid', async (req, res) => {
  const { blogid } = req.params;
  const { title, detail, category } = req.body;
  try {
      const [result] = await pool.query(
          'UPDATE blog SET title = ?, detail = ?, category = ? WHERE blogid = ?',
          [title, detail, category, blogid]
      );
      if (result.affectedRows === 0) {
          return res.status(404).json({ message: 'Blog not found' });
      }
      return res.json({ message: 'Blog updated successfully' });
  } catch (err) {
      console.error("Error updating SQL: ", err); // ตรวจสอบข้อผิดพลาด SQL
      return res.status(500).json({ message: 'Error updating the blog', error: err });
  }
});

// เริ่มเซิร์ฟเวอร์
app.listen(port, () => console.log(`Server running on port ${port}!`));
