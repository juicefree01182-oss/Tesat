

// تهيئة Firebase (يتم استدعاؤها من firebase-config.js)
let authFB, db, currentUser;

// تهيئة التطبيق بعد تحميل الصفحة
document.addEventListener('DOMContentLoaded', function() {
    // تهيئة Firebase
    authFB = firebase.auth();
    db = firebase.firestore();
    
    // إعداد مستمعات الأحداث للأزرار
    setupEventListeners();
    
    // مراقبة حالة المصادقة
    setupAuthListener();
});

// إعداد مستمعات الأحداث
function setupEventListeners() {
    // أزرار المصادقة
    document.getElementById('loginBtn').addEventListener('click', login);
    document.getElementById('registerBtn').addEventListener('click', register);
    
    // أزرار العمليات البنكية
    document.getElementById('depositBtn').addEventListener('click', deposit);
    document.getElementById('withdrawBtn').addEventListener('click', withdraw);
    document.getElementById('transferBtn').addEventListener('click', transfer);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    // السماح بالضغط على Enter في حقول الإدخال
    document.getElementById('password').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') login();
    });
}

// إعداد مستمع حالة المصادقة
function setupAuthListener() {
    authFB.onAuthStateChanged(user => {
        currentUser = user;
        const authDiv = document.getElementById('auth');
        const bankDiv = document.getElementById('bank');
        
        if (user) {
            // تسجيل الدخول الناجح
            authDiv.classList.add('hidden');
            bankDiv.classList.remove('hidden');
            
            // تحميل بيانات المستخدم
            loadUserData(user.uid);
            
            // إضافة رسالة ترحيب
            showAlert(`مرحباً ${user.email}`, 'success');
        } else {
            // تسجيل الخروج
            bankDiv.classList.add('hidden');
            authDiv.classList.remove('hidden');
            clearInputs();
        }
    });
}

// تحميل بيانات المستخدم
function loadUserData(uid) {
    const balanceElement = document.getElementById('balance');
    const accountElement = document.getElementById('account');
    
    db.collection('users').doc(uid)
        .onSnapshot(doc => {
            if (doc.exists) {
                const userData = doc.data();
                balanceElement.textContent = userData.balance + ' SDG';
                accountElement.textContent = 'رقم الحساب: ' + userData.account;
            }
        }, error => {
            showAlert('خطأ في تحميل البيانات: ' + error.message, 'error');
        });
}

// ========== تسجيل مستخدم جديد ==========
async function register() {
    try {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        if (!email || !password) {
            showAlert('الرجاء إدخال البريد الإلكتروني وكلمة المرور', 'error');
            return;
        }
        
        const res = await authFB.createUserWithEmailAndPassword(email, password);
        
        // إنشاء سجل المستخدم في Firestore
        await db.collection('users').doc(res.user.uid).set({
            email: email,
            balance: 0,
            account: 'BNK-' + Math.floor(100000 + Math.random() * 900000),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        showAlert('تم إنشاء الحساب بنجاح!', 'success');
        clearInputs();
    } catch (error) {
        showAlert(error.message, 'error');
    }
}

// ========== تسجيل الدخول ==========
async function login() {
    try {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        if (!email || !password) {
            showAlert('الرجاء إدخال البريد الإلكتروني وكلمة المرور', 'error');
            return;
        }
        
        await authFB.signInWithEmailAndPassword(email, password);
        clearInputs();
    } catch (error) {
        showAlert(error.message, 'error');
    }
}

// ========== تسجيل الخروج ==========
function logout() {
    authFB.signOut();
    showAlert('تم تسجيل الخروج بنجاح', 'success');
}

// ========== إيداع أموال ==========
async function deposit() {
    if (!requireAuth()) return;
    
    const amount = Number(document.getElementById('amount').value);
    if (!amount || amount <= 0) {
        showAlert('الرجاء إدخال مبلغ صحيح للإيداع', 'error');
        return;
    }
    
    try {
        const userRef = db.collection('users').doc(currentUser.uid);
        
        await db.runTransaction(async transaction => {
            const doc = await transaction.get(userRef);
            if (!doc.exists) throw new Error('المستخدم غير موجود');
            
            const newBalance = doc.data().balance + amount;
            transaction.update(userRef, { balance: newBalance });
            
            return newBalance;
        });
        
        showAlert(`تم إيداع ${amount} SDG بنجاح`, 'success');
        document.getElementById('amount').value = '';
        
        // تسجيل المعاملة
        await logTransaction('deposit', amount);
    } catch (error) {
        showAlert(error.message, 'error');
    }
}

// ========== سحب أموال ==========
async function withdraw() {
    if (!requireAuth()) return;
    
    const amount = Number(document.getElementById('amount').value);
    if (!amount || amount <= 0) {
        showAlert('الرجاء إدخال مبلغ صحيح للسحب', 'error');
        return;
    }
    
    try {
        const userRef = db.collection('users').doc(currentUser.uid);
        
        await db.runTransaction(async transaction => {
            const doc = await transaction.get(userRef);
            if (!doc.exists) throw new Error('المستخدم غير موجود');
            
            const currentBalance = doc.data().balance;
            if (currentBalance < amount) {
                throw new Error('رصيد غير كافٍ للسحب');
            }
            
            const newBalance = currentBalance - amount;
            transaction.update(userRef, { balance: newBalance });
            
            return newBalance;
        });
        
        showAlert(`تم سحب ${amount} SDG بنجاح`, 'success');
        document.getElementById('amount').value = '';
        
        // تسجيل المعاملة
        await logTransaction('withdraw', amount);
    } catch (error) {
        showAlert(error.message, 'error');
    }
}

// ========== تحويل أموال ==========
async function transfer() {
    if (!requireAuth()) return;
    
    const toUid = document.getElementById('toUid').value;
    const amount = Number(document.getElementById('transferAmount').value);
    
    if (!toUid) {
        showAlert('الرجاء إدخال معرف المستلم', 'error');
        return;
    }
    
    if (!amount || amount <= 0) {
        showAlert('الرجاء إدخال مبلغ صحيح للتحويل', 'error');
        return;
    }
    
    if (toUid === currentUser.uid) {
        showAlert('لا يمكن التحويل لنفسك', 'error');
        return;
    }
    
    try {
        const fromRef = db.collection('users').doc(currentUser.uid);
        const toRef = db.collection('users').doc(toUid);
        
        await db.runTransaction(async transaction => {
            const fromDoc = await transaction.get(fromRef);
            const toDoc = await transaction.get(toRef);
            
            if (!fromDoc.exists) throw new Error('الحساب المصدر غير موجود');
            if (!toDoc.exists) throw new Error('الحساب المستلم غير موجود');
            
            const fromBalance = fromDoc.data().balance;
            const toBalance = toDoc.data().balance;
            
            if (fromBalance < amount) {
                throw new Error('رصيد غير كافٍ للتحويل');
            }
            
            // تحديث الرصيد في الحسابين
            transaction.update(fromRef, { balance: fromBalance - amount });
            transaction.update(toRef, { balance: toBalance + amount });
            
            return { fromBalance: fromBalance - amount, toBalance: toBalance + amount };
        });
        
        showAlert(`تم تحويل ${amount} SDG بنجاح`, 'success');
        document.getElementById('toUid').value = '';
        document.getElementById('transferAmount').value = '';
        
        // تسجيل المعاملة
        await logTransaction('transfer', amount, toUid);
    } catch (error) {
        showAlert(error.message, 'error');
    }
}

// ========== وظائف مساعدة ==========

// التحقق من المصادقة
function requireAuth() {
    if (!currentUser) {
        showAlert('الرجاء تسجيل الدخول أولاً', 'error');
        return false;
    }
    return true;
}

// عرض رسائل التنبيه
function showAlert(message, type = 'info') {
    // إزالة أي رسالة سابقة
    const existingAlert = document.querySelector('.alert');
    if (existingAlert) existingAlert.remove();
    
    // إنشاء عنصر الرسالة الجديدة
    const alertElement = document.createElement('div');
    alertElement.className = `alert ${type}`;
    alertElement.textContent = message;
    
    // إضافة الرسالة إلى الصفحة
    const container = document.querySelector('.container');
    container.prepend(alertElement);
    
    // إزالة الرسالة تلقائياً بعد 5 ثواني
    setTimeout(() => {
        if (alertElement.parentNode) {
            alertElement.remove();
        }
    }, 5000);
}

// مسح حقول الإدخال
function clearInputs() {
    document.getElementById('email').value = '';
    document.getElementById('password').value = '';
    document.getElementById('amount').value = '';
    document.getElementById('toUid').value = '';
    document.getElementById('transferAmount').value = '';
}

// تسجيل المعاملة (وظيفة إضافية)
async function logTransaction(type, amount, toUid = null) {
    try {
        const transactionData = {
            userId: currentUser.uid,
            type: type,
            amount: amount,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        if (toUid) {
            transactionData.toUid = toUid;
        }
        
        await db.collection('transactions').add(transactionData);
    } catch (error) {
        console.error('خطأ في تسجيل المعاملة:', error);
    }
}