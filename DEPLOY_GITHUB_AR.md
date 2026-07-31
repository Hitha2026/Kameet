# رفع Pong Network Arena على GitHub

## 1. رفع الكود إلى مستودع GitHub

أنشئ مستودعًا فارغًا في حسابك على GitHub، ثم افتح Terminal داخل مجلد المشروع ونفّذ:

```bash
git init
git add .
git commit -m "Pong Network Arena 2.1"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

في Windows يمكن بدلًا من ذلك تشغيل:

```text
UPLOAD_TO_GITHUB.bat https://github.com/USERNAME/REPOSITORY.git
```

## 2. نشر نسخة GitHub Pages

المشروع يتضمن Workflow جاهزًا داخل:

```text
.github/workflows/pages.yml
```

بعد رفع المشروع:

1. افتح المستودع في GitHub.
2. افتح **Settings → Pages**.
3. اجعل Source هو **GitHub Actions**.
4. افتح تبويب **Actions** وتأكد من نجاح `Deploy Web Game to GitHub Pages`.

نسخة GitHub Pages ستشغّل اللعب ضد الذكاء الاصطناعي مباشرة.

## 3. تفعيل اللعب الأونلاين على نسخة GitHub Pages

GitHub Pages يستضيف الملفات الثابتة فقط، ولا يشغّل `server.js` أو اتصالات Socket.IO الخلفية. لذلك يجب نشر خادم Node.js لدى مزود يدعم WebSocket وHTTPS، ثم تعديل:

```text
public/config.js
```

مثال:

```javascript
window.PONG_CONFIG = Object.freeze({
  serverUrl: "https://your-pong-server.example.com"
});
```

وفي الخادم اضبط:

```text
ALLOWED_ORIGIN=https://USERNAME.github.io
JWT_SECRET=قيمة-سرية-طويلة-وعشوائية
NODE_ENV=production
```

## 4. تشغيل المشروع الكامل من مستودع GitHub

يمكن لأي منصة تستضيف Node.js استيراد المستودع ثم تنفيذ:

```text
Build command: npm install
Start command: npm start
Health check: /api/health
```

## 5. حماية البيانات

- ملف `.env` مستبعد من Git بواسطة `.gitignore`.
- ملف `data/users.json` مستبعد حتى لا تُرفع حسابات المستخدمين.
- ينشئ الخادم ملف المستخدمين تلقائيًا عند أول تشغيل.
- لا تضع `JWT_SECRET` الحقيقي داخل GitHub.
