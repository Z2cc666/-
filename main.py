from flask import Flask, request, jsonify, send_from_directory, Response
from model import retriever, chain  # 确保导入chain
import logging
from flask_cors import CORS
import os
import json
import time
import random
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
import sqlite3
import csv
import io
from dotenv import load_dotenv
# 加载 .env 文件中的环境变量
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# 仓库根路径
repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# SQLite DB 文件（可通过环境变量覆盖）
DB_FILE = os.environ.get("USERS_DB_PATH", os.path.join(repo_root, "server", "app.db"))


def get_db_conn():
    conn = sqlite3.connect(DB_FILE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _dbg(s):
    import sys; sys.stderr.write(f"[DBG] {s}\n"); sys.stderr.flush()


def init_db():
    conn = get_db_conn()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            display_name TEXT,
            avatar_url TEXT,
            health_info TEXT,
            allergies TEXT,
            medical_history TEXT
        )
        """
    )
    # ensure any missing columns exist for users_doctor (e.g., rejection_note)
    cur.execute("PRAGMA table_info(users_doctor)")
    doc_cols = {r[1] for r in cur.fetchall()}
    needed_doctor_cols = {
        "rejection_note": "TEXT",
        "settings": "TEXT",
        "accept_consultations": "INTEGER DEFAULT 1",
        "title": "TEXT DEFAULT ''"
    }
    for col, typ in needed_doctor_cols.items():
        if col not in doc_cols:
            try:
                cur.execute(f"ALTER TABLE users_doctor ADD COLUMN {col} {typ}")
                logging.info(f"Added {col} column to users_doctor")
            except Exception:
                pass
    # ensure any missing columns exist (for older DBs)
    cur.execute("PRAGMA table_info(users)")
    cols = {r[1] for r in cur.fetchall()}
    needed = {
        "display_name": "TEXT",
        "avatar_url": "TEXT",
        "health_info": "TEXT",
        "allergies": "TEXT",
        "medical_history": "TEXT",
        "is_admin": "INTEGER DEFAULT 0",
        "is_banned": "INTEGER DEFAULT 0",
        "gender": "TEXT",
        "birthday": "TEXT",
        "height": "TEXT",
        "weight": "TEXT",
        "blood_type": "TEXT",
        "chronic": "TEXT",
        "medications": "TEXT",
        "emergency_name": "TEXT",
        "emergency_phone": "TEXT",
        "insurance": "TEXT",
        "id_card": "TEXT",
        "last_login_at": "INTEGER",
        "is_frozen": "INTEGER DEFAULT 0",
    }
    for col, typ in needed.items():
        if col not in cols:
            try:
                cur.execute(f"ALTER TABLE users ADD COLUMN {col} {typ}")
            except Exception:
                pass
    # verification codes table for SMS/email login
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS verification_codes (
            contact TEXT,
            method TEXT,
            code TEXT,
            expires_at INTEGER,
            created_at INTEGER
        )
        """
    )
    # settings audit table
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS settings_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doctor_username TEXT,
                actor TEXT,
                changes TEXT,
                created_at INTEGER
            )
        """)
    except Exception:
        pass
    # cases table: store chats/cases per user
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS cases (
            id TEXT PRIMARY KEY,
            owner TEXT,
            title TEXT,
            messages TEXT,
            created_at INTEGER,
            updated_at INTEGER,
            status TEXT DEFAULT 'pending',
            assigned_doctor TEXT,
            symptoms TEXT,
            diagnosis TEXT,
            completed_at INTEGER
        )
        """
    )
    # tags table for cases
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS case_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT,
            tag TEXT,
            created_at INTEGER
        )
        """
    )

    # Add missing columns to existing cases table
    cur.execute("PRAGMA table_info(cases)")
    cols = {r[1] for r in cur.fetchall()}
    needed = {
        "status": "TEXT DEFAULT 'pending'",
        "assigned_doctor": "TEXT",
        "symptoms": "TEXT",
        "diagnosis": "TEXT",
        "completed_at": "INTEGER",
        "prescriptions": "TEXT",
        "billings": "TEXT",
        "chat_banned": "INTEGER DEFAULT 0",
        "parent_case_id": "TEXT",
        "source": "TEXT DEFAULT 'manual'"  # 'manual'=人工接诊, 'ai'=AI智能问答
    }
    for col, typ in needed.items():
        if col not in cols:
            try:
                cur.execute(f"ALTER TABLE cases ADD COLUMN {col} {typ}")
            except Exception:
                pass
    # appointments table
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT,
            doctor_username TEXT,
            patient_username TEXT,
            patient_name TEXT,
            patient_phone TEXT,
            start_ts INTEGER,
            end_ts INTEGER,
            status TEXT DEFAULT 'scheduled',
            department_id INTEGER,
            notes TEXT,
            schedule_id INTEGER,
            created_at INTEGER
        )
        """
    )
    # ensure missing columns for appointments (for older DBs)
    cur.execute("PRAGMA table_info(appointments)")
    appt_cols = {r[1] for r in cur.fetchall()}
    needed_appt_cols = {
        "patient_username": "TEXT",
        "patient_name": "TEXT",
        "patient_phone": "TEXT",
        "department_id": "INTEGER",
        "notes": "TEXT",
        "schedule_id": "INTEGER"
    }
    for col, typ in needed_appt_cols.items():
        if col not in appt_cols:
            try:
                cur.execute(f"ALTER TABLE appointments ADD COLUMN {col} {typ}")
                logging.info(f"Added {col} column to appointments")
            except Exception:
                pass
    # departments table: 科室表
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS departments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            icon TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at INTEGER
        )
        """
    )
    # doctor_schedules table: 医生排班表
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS doctor_schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doctor_username TEXT NOT NULL,
            date TEXT NOT NULL,  -- 格式: YYYY-MM-DD
            start_time TEXT NOT NULL,  -- 格式: HH:MM
            end_time TEXT NOT NULL,
            max_appointments INTEGER DEFAULT 10,
            current_appointments INTEGER DEFAULT 0,
            is_available INTEGER DEFAULT 1,
            fee REAL DEFAULT 0,  -- 挂号费用
            created_at INTEGER,
            FOREIGN KEY (doctor_username) REFERENCES users_doctor(username)
        )
        """
    )
    # 确保排班表的fee列存在（兼容旧数据库）
    cur.execute("PRAGMA table_info(doctor_schedules)")
    sched_cols = {r[1] for r in cur.fetchall()}
    if "fee" not in sched_cols:
        try:
            cur.execute("ALTER TABLE doctor_schedules ADD COLUMN fee REAL DEFAULT 0")
            logging.info("Added fee column to doctor_schedules")
        except Exception as e:
            logging.error(f"adding fee column failed: {e}", exc_info=True)

    # ensure any missing columns exist for appointments
    cur.execute("PRAGMA table_info(appointments)")
    app_cols = {r[1] for r in cur.fetchall()}
    if "patient_name" not in app_cols:
        try:
            cur.execute("ALTER TABLE appointments ADD COLUMN patient_name TEXT")
        except Exception:
            pass
    if "patient_phone" not in app_cols:
        try:
            cur.execute("ALTER TABLE appointments ADD COLUMN patient_phone TEXT")
        except Exception:
            pass
    if "department_id" not in app_cols:
        try:
            cur.execute("ALTER TABLE appointments ADD COLUMN department_id INTEGER")
        except Exception:
            pass
    if "notes" not in app_cols:
        try:
            cur.execute("ALTER TABLE appointments ADD COLUMN notes TEXT")
        except Exception:
            pass
    if "schedule_id" not in app_cols:
        try:
            cur.execute("ALTER TABLE appointments ADD COLUMN schedule_id INTEGER")
        except Exception:
            pass
    if "patient_username" not in app_cols:
        try:
            cur.execute("ALTER TABLE appointments ADD COLUMN patient_username TEXT")
        except Exception:
            pass

    # 确保department_id列存在
    try:
        cur.execute("PRAGMA table_info(users_doctor)")
        cols = {r[1] for r in cur.fetchall()}
        if "department_id" not in cols:
            cur.execute("ALTER TABLE users_doctor ADD COLUMN department_id INTEGER")
            logging.info("Added department_id column to users_doctor")
    except Exception as e:
        logging.error(f"adding department_id column failed: {e}", exc_info=True)

    # doctors table: store doctor accounts and qualifications
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users_doctor (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT,
            avatar_url TEXT,
            clinic TEXT,
            license_number TEXT,
            license_expiry TEXT,
            verified INTEGER DEFAULT 0,
            specialties TEXT,
            bio TEXT,
            phone TEXT,
            department_id INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            is_deleted INTEGER DEFAULT 0,
            license_file_url TEXT
        )
        """
    )
    # ensure an admin account exists (username: 123456789, password: 123456)
    try:
        cur.execute("SELECT 1 FROM users WHERE username = ?", ("123456789",))
        if not cur.fetchone():
            admin_pw_hash = generate_password_hash("123456")
            now = int(time.time())
            cur.execute("INSERT INTO users (username, password_hash, created_at, display_name) VALUES (?, ?, ?, ?)",
                        ("123456789", admin_pw_hash, now, "系统管理员"))
            logging.info("Inserted default admin user '123456789'")
    except Exception as e:
        logging.error(f"creating default admin failed: {e}", exc_info=True)
    
    # 初始化默认科室
    try:
        cur.execute("SELECT COUNT(*) FROM departments")
        if cur.fetchone()[0] == 0:
            now = int(time.time())
            default_depts = [
                ("内科", "心血管、呼吸、消化等内科疾病", "heart", 1),
                ("外科", "外科手术、创伤处理", "knife", 2),
                ("儿科", "儿童疾病诊疗", "baby", 3),
                ("妇科", "妇科疾病、孕期检查", "woman", 4),
                ("皮肤科", "皮肤疾病、过敏反应", "skin", 5),
                ("眼科", "眼部疾病、视力检查", "eye", 6),
                ("耳鼻喉科", "耳、鼻、喉部疾病", "ear", 7),
                ("口腔科", "牙齿、口腔疾病", "tooth", 8),
                ("骨科", "骨骼、关节疾病", "bone", 9),
                ("神经科", "神经系统疾病", "brain", 10),
                ("心血管科", "高血压、冠心病、心律失常等心血管疾病", "heart-pulse", 11),
                ("消化内科", "胃炎、胃溃疡、肝炎等消化系统疾病", "stomach", 12),
                ("呼吸内科", "感冒、肺炎、哮喘等呼吸系统疾病", "lungs", 13),
                ("内分泌科", "糖尿病、甲状腺疾病等内分泌疾病", "activity", 14),
                ("泌尿外科", "肾结石、前列腺疾病、泌尿系统疾病", "droplet", 15),
                ("肿瘤科", "癌症筛查、诊断与治疗", "shield", 16),
                ("精神科", "抑郁症、焦虑症等精神心理疾病", "brain", 17),
                ("康复科", "术后康复、运动损伤恢复", "person", 18),
                ("中医科", "中医诊疗、针灸推拿", "leaf", 19),
                ("急诊科", "急危重症抢救、急诊处理", "alert", 20),
            ]
            cur.executemany(
                "INSERT INTO departments (name, description, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
                [(name, desc, icon, sort_order, now) for name, desc, icon, sort_order in default_depts]
            )
            logging.info("Inserted default departments")
    except Exception as e:
        logging.error(f"creating default departments failed: {e}", exc_info=True)
    
    conn.commit()
    conn.close()
    # drugs table for medication catalog
    try:
        conn2 = get_db_conn()
        cur2 = conn2.cursor()
        cur2.execute("""
            CREATE TABLE IF NOT EXISTS drugs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                price REAL DEFAULT 0,
                unit TEXT,
                category TEXT,
                created_at INTEGER
            )
        """)
        # ensure category column exists for older DBs
        cur2.execute("PRAGMA table_info(drugs)")
        drug_cols = {r[1] for r in cur2.fetchall()}
        if "category" not in drug_cols:
            try:
                cur2.execute("ALTER TABLE drugs ADD COLUMN category TEXT")
            except Exception:
                pass
        # seed common drugs if table empty
        cur2.execute("SELECT COUNT(1) as c FROM drugs")
        cnt = cur2.fetchone()
        cval = 0
        try:
            if isinstance(cnt, tuple):
                cval = cnt[0]
            elif isinstance(cnt, dict):
                cval = cnt.get("c", 0)
            elif cnt is None:
                cval = 0
            else:
                # sqlite Row may be indexable
                cval = cnt[0]
        except Exception:
            cval = 0

        if cval == 0:
            now = int(time.time())
            seed_drugs = [
                ("Paracetamol (325mg)", 0.5, "tablet"),
                ("Ibuprofen (200mg)", 0.6, "tablet"),
                ("Amoxicillin (500mg)", 1.2, "capsule"),
                ("Amoxicillin-Clavulanate (500/125mg)", 2.0, "tablet"),
                ("Azithromycin (250mg)", 2.5, "tablet"),
                ("Ciprofloxacin (500mg)", 2.2, "tablet"),
                ("Doxycycline (100mg)", 1.8, "capsule"),
                ("Cephalexin (500mg)", 1.5, "capsule"),
                ("Metformin (500mg)", 0.8, "tablet"),
                ("Atorvastatin (10mg)", 1.5, "tablet"),
                ("Simvastatin (20mg)", 1.2, "tablet"),
                ("Lisinopril (10mg)", 1.0, "tablet"),
                ("Metoprolol (50mg)", 0.9, "tablet"),
                ("Atenolol (50mg)", 0.9, "tablet"),
                ("Omeprazole (20mg)", 1.0, "capsule"),
                ("Esomeprazole (20mg)", 1.4, "capsule"),
                ("Salbutamol Inhaler (100mcg)", 15.0, "inhaler"),
                ("Cetirizine (10mg)", 0.7, "tablet"),
                ("Loratadine (10mg)", 0.7, "tablet"),
                ("Prednisone (5mg)", 0.9, "tablet"),
                ("Fluconazole (150mg)", 3.5, "tablet"),
                ("Insulin (Regular)", 25.0, "vial"),
                ("Warfarin (5mg)", 1.8, "tablet"),
                ("Clopidogrel (75mg)", 2.0, "tablet"),
                ("Hydrochlorothiazide (25mg)", 0.6, "tablet"),
                ("Furosemide (40mg)", 0.7, "tablet"),
                ("Levothyroxine (50mcg)", 1.0, "tablet"),
                ("Sertraline (50mg)", 1.6, "tablet"),
                ("Escitalopram (10mg)", 1.7, "tablet"),
                ("Aspirin (81mg)", 0.4, "tablet")
            ]
            for name, price, unit, category in seed_drugs:
                try:
                    cur2.execute("INSERT INTO drugs (name, price, unit, category, created_at) VALUES (?, ?, ?, ?, ?)",
                                (name, price, unit, category, now))
                except Exception:
                    pass
            conn2.commit()
        conn2.close()
    except Exception:
        pass


def add_user_to_db(username: str, password_hash: str):
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                    (username, password_hash, int(__import__("time").time())))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()


def get_user_hash_from_db(username: str):
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT password_hash FROM users WHERE username = ?", (username,))
        row = cur.fetchone()
        return row["password_hash"] if row else None
    finally:
        conn.close()


def check_patient_login_allowed(username: str):
    """患者端登录前校验：禁用/冻结不可登录。返回 (True, None) 或 (False, 错误信息)。"""
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT COALESCE(is_banned,0), COALESCE(is_frozen,0), COALESCE(is_admin,0) FROM users WHERE username = ?",
            (username,),
        )
        row = cur.fetchone()
        if not row:
            return True, None
        banned, frozen, is_admin = int(row[0] or 0), int(row[1] or 0), int(row[2] or 0)
        if is_admin:
            return True, None
        if banned:
            return False, "账号已被禁用，无法登录"
        if frozen:
            return False, "账号已冻结，请联系管理员解冻"
        return True, None
    finally:
        conn.close()


def touch_user_last_login(username: str):
    try:
        now = int(time.time())
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("UPDATE users SET last_login_at = ? WHERE username = ?", (now, username))
        conn.commit()
        conn.close()
    except Exception as e:
        logging.warning(f"touch_user_last_login failed: {e}")


def _generate_numeric_code(length=6):
    return "".join(str(random.randint(0, 9)) for _ in range(length))


def send_verification_code(contact: str, method: str = "sms", ttl_seconds: int = 300):
    """
    Generate a numeric code, store it in verification_codes table with expiry.
    This is a dev implementation: it logs the code instead of sending SMS/email.
    """
    code = _generate_numeric_code(6)
    now = int(time.time())
    expires = now + ttl_seconds
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute("INSERT INTO verification_codes (contact, method, code, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
                    (contact, method, code, expires, now))
        conn.commit()
    finally:
        conn.close()
    logging.info(f"Generated verification code for {contact} ({method}): {code} (expires in {ttl_seconds}s)")
    # TODO: integrate real SMS/email provider here
    return code


def verify_code(contact: str, method: str, code: str):
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        now = int(time.time())
        cur.execute("SELECT code, expires_at FROM verification_codes WHERE contact = ? AND method = ? ORDER BY created_at DESC LIMIT 1",
                    (contact, method))
        row = cur.fetchone()
        if not row:
            return False
        if row["code"] != code:
            return False
        if row["expires_at"] < now:
            return False
        return True
    finally:
        conn.close()


def get_cases_for_user(username: str):
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, title, messages, created_at, updated_at, status, assigned_doctor FROM cases WHERE owner = ? ORDER BY updated_at DESC", (username,))
        rows = cur.fetchall()
        out = []
        for r in rows:
            try:
                msgs = json.loads(r["messages"]) if r["messages"] else []
            except Exception:
                msgs = []
            out.append({
                "id": r["id"],
                "title": r["title"],
                "messages": msgs,
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
                "status": r["status"],
                "assigned_doctor": r["assigned_doctor"]
            })
        return out
    finally:
        conn.close()


def upsert_case(case_obj, owner):
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        now = int(time.time())
        cid = case_obj.get("id") or f"case-{now}-{int(time.time()*1000)%1000}"
        title = case_obj.get("title", "会话")
        messages = json.dumps(case_obj.get("messages", []), ensure_ascii=False)
        # try update
        cur.execute("SELECT 1 FROM cases WHERE id = ?", (cid,))
        exists = cur.fetchone()
        if exists:
            cur.execute("UPDATE cases SET title = ?, messages = ?, updated_at = ? WHERE id = ?", (title, messages, now, cid))
        else:
            cur.execute("INSERT INTO cases (id, owner, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (cid, owner, title, messages, now, now))
        conn.commit()
        return cid
    finally:
        conn.close()


# 初始化数据库
init_db()

app = Flask(__name__)
# Configure CORS to explicitly allow common headers and credentials for XHR from frontend
from flask_cors import CORS as _CORS
_CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True, allow_headers=["Content-Type", "Authorization", "Access-Control-Allow-Origin", "Access-Control-Allow-Headers"])

# Also ensure responses include proper CORS headers for preflight requests
@app.after_request
def add_cors_headers(response):
    response.headers.setdefault('Access-Control-Allow-Origin', '*')
    response.headers.setdefault('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.setdefault('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    return response

# secret key for token signing (可通过环境变量覆盖)
app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "change-me-in-production")
serializer = URLSafeTimedSerializer(app.config["SECRET_KEY"])

# users 存储文件（简单实现，不适合生产）
repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
USERS_FILE = os.environ.get("USERS_FILE", os.path.join(repo_root, "server", "users.json"))

# 配置日志格式
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)


def load_users():
    if not os.path.exists(USERS_FILE):
        return {}
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_users(users):
    try:
        with open(USERS_FILE, "w", encoding="utf-8") as f:
            json.dump(users, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logging.error(f"保存用户文件失败: {e}")


@app.route("/register", methods=["POST"])
def register():
    try:
        data = request.get_json() or {}
        username = data.get("username", "").strip()
        password = data.get("password", "")
        if not username or not password:
            return jsonify({"error": "必须提供 username 和 password"}), 400
        # 使用 sqlite 存储
        ph = generate_password_hash(password)
        ok = add_user_to_db(username, ph)
        if not ok:
            return jsonify({"error": "用户名已存在"}), 400
        logging.info(f"新用户注册 (db): {username}")
        # 自动登录：返回 token 与 username
        token = serializer.dumps({"username": username})
        return jsonify({"ok": True, "token": token, "username": username})
    except Exception as e:
        logging.error(f"注册失败: {e}", exc_info=True)
        return jsonify({"error": "注册失败", "details": str(e)}), 500


@app.route("/login", methods=["POST"])
def login():
    try:
        data = request.get_json() or {}
        username = data.get("username", "").strip()
        password = data.get("password", "")
        if not username or not password:
            return jsonify({"error": "必须提供 username 和 password"}), 400
        # 从 sqlite 中读取
        ph = get_user_hash_from_db(username)
        if not ph or not check_password_hash(ph, password):
            return jsonify({"error": "用户名或密码错误"}), 401
        ok_login, ban_msg = check_patient_login_allowed(username)
        if not ok_login:
            return jsonify({"error": ban_msg}), 403
        touch_user_last_login(username)
        token = serializer.dumps({"username": username})
        logging.info(f"用户登录 (db): {username}")
        return jsonify({"token": token, "username": username})
    except Exception as e:
        logging.error(f"登录失败: {e}", exc_info=True)
        return jsonify({"error": "登录失败", "details": str(e)}), 500


def add_doctor_to_db(username: str, password_hash: str, license_number: str = "", clinic: str = ""):
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users_doctor (username, password_hash, license_number, clinic, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (username, password_hash, license_number, clinic, int(__import__("time").time()), int(__import__("time").time()))
        )
        conn.commit()
        return True
    except Exception as e:
        logging.error(f"添加医生到数据库失败: {e}")
        return False
    finally:
        conn.close()


def get_doctor_hash_from_db(username: str):
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT password_hash FROM users_doctor WHERE username = ? AND is_deleted = 0", (username,))
        row = cur.fetchone()
        return row[0] if row else None
    except Exception as e:
        logging.error(f"获取医生密码哈希失败: {e}")
        return None
    finally:
        conn.close()


@app.route("/doctor-register", methods=["POST"])
def doctor_register():
    try:
        data = request.get_json() or {}
        username = data.get("username", "").strip()
        password = data.get("password", "")
        license_number = data.get("license_number", "").strip()
        clinic = data.get("clinic", "").strip()

        if not username or not password:
            return jsonify({"error": "必须提供 username 和 password"}), 400

        # 使用 sqlite 存储
        ph = generate_password_hash(password)
        ok = add_doctor_to_db(username, ph, license_number, clinic)
        if not ok:
            return jsonify({"error": "用户名已存在"}), 400

        logging.info(f"新医生注册 (db): {username}")
        # 自动登录：返回 token 与 username
        token = serializer.dumps({"username": username, "user_type": "doctor"})
        return jsonify({"ok": True, "token": token, "username": username, "user_type": "doctor"})
    except Exception as e:
        logging.error(f"医生注册失败: {e}", exc_info=True)
        return jsonify({"error": "注册失败", "details": str(e)}), 500


@app.route("/doctor-login", methods=["POST"])
def doctor_login():
    try:
        data = request.get_json() or {}
        username = data.get("username", "").strip()
        password = data.get("password", "")
        if not username or not password:
            return jsonify({"error": "必须提供 username 和 password"}), 400

        # 从 sqlite 中读取
        ph = get_doctor_hash_from_db(username)
        if not ph or not check_password_hash(ph, password):
            return jsonify({"error": "用户名或密码错误"}), 401

        token = serializer.dumps({"username": username, "user_type": "doctor"})
        logging.info(f"医生登录 (db): {username}")
        return jsonify({"token": token, "username": username, "user_type": "doctor"})
    except Exception as e:
        logging.error(f"医生登录失败: {e}", exc_info=True)
        return jsonify({"error": "登录失败", "details": str(e)}), 500


@app.route("/send_code", methods=["POST"])
def api_send_code():
    try:
        data = request.get_json() or {}
        contact = (data.get("contact") or "").strip()
        method = (data.get("method") or "sms").lower()  # 'sms' or 'email'
        if not contact:
            return jsonify({"error": "必须提供 contact 字段"}), 400
        # basic validation could be added here
        code = send_verification_code(contact, method)
        # For development we return a success; do NOT return code in production.
        return jsonify({"ok": True, "note": "code generated (dev)", "dev_code": code})
    except Exception as e:
        logging.error(f"发送验证码失败: {e}", exc_info=True)
        return jsonify({"error": "发送失败"}), 500


@app.route("/verify_code", methods=["POST"])
def api_verify_code():
    try:
        data = request.get_json() or {}
        contact = (data.get("contact") or "").strip()
        method = (data.get("method") or "sms").lower()
        code = (data.get("code") or "").strip()
        if not contact or not code:
            return jsonify({"error": "缺少 contact 或 code"}), 400
        ok = verify_code(contact, method, code)
        if not ok:
            return jsonify({"error": "验证码无效或已过期"}), 400
        # find or create user account bound to this contact
        username = contact
        # if user doesn't exist, create a user with a random password
        conn = get_db_conn()
        try:
            cur = conn.cursor()
            cur.execute("SELECT username FROM users WHERE username = ?", (username,))
            if not cur.fetchone():
                ph = generate_password_hash(_generate_numeric_code(10))
                cur.execute("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                            (username, ph, int(time.time())))
                conn.commit()
        finally:
            conn.close()
        ok_login, ban_msg = check_patient_login_allowed(username)
        if not ok_login:
            return jsonify({"error": ban_msg}), 403
        touch_user_last_login(username)
        token = serializer.dumps({"username": username})
        return jsonify({"ok": True, "token": token, "username": username})
    except Exception as e:
        logging.error(f"验证码校验失败: {e}", exc_info=True)
        return jsonify({"error": "校验失败"}), 500


def get_username_from_header():
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        try:
            data = serializer.loads(token, max_age=60 * 60 * 24)
            return data.get("username")
        except Exception:
            return None
    return None


@app.route("/profile", methods=["GET"])
def get_profile():
    try:
        username = get_username_from_header()
        if not username:
            return jsonify({"error": "未认证"}), 401
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT username, display_name, avatar_url, health_info, allergies, medical_history, gender, birthday, height, weight, blood_type, chronic, medications, emergency_name, emergency_phone, insurance, id_card FROM users WHERE username = ?", (username,))
        row = cur.fetchone()
        conn.close()
        if not row:
            return jsonify({"error": "用户不存在"}), 404
        return jsonify({
            "username": row["username"],
            "display_name": row["display_name"],
            "avatar_url": row["avatar_url"],
            "health_info": row["health_info"],
            "allergies": row["allergies"],
            "medical_history": row["medical_history"],
            "gender": row["gender"],
            "birthday": row["birthday"],
            "height": row["height"],
            "weight": row["weight"],
            "blood_type": row["blood_type"],
            "chronic": row["chronic"],
            "medications": row["medications"],
            "emergency_name": row["emergency_name"],
            "emergency_phone": row["emergency_phone"],
            "insurance": row["insurance"],
            "id_card": row["id_card"] or ""
        })
    except Exception as e:
        logging.error(f"获取 profile 失败: {e}", exc_info=True)
        return jsonify({"error": "内部错误"}), 500


@app.route("/profile", methods=["POST"])
def update_profile():
    try:
        username = get_username_from_header()
        if not username:
            return jsonify({"error": "未认证"}), 401
        data = request.get_json() or {}
        display_name = data.get("display_name")
        avatar_url = data.get("avatar_url")
        health_info = data.get("health_info")
        allergies = data.get("allergies")
        medical_history = data.get("medical_history")
        gender = data.get("gender")
        birthday = data.get("birthday")
        height = data.get("height")
        weight = data.get("weight")
        blood_type = data.get("blood_type")
        chronic = data.get("chronic")
        medications = data.get("medications")
        emergency_name = data.get("emergency_name")
        emergency_phone = data.get("emergency_phone")
        insurance = data.get("insurance")
        conn = get_db_conn()
        cur = conn.cursor()
        id_card = data.get("id_card")
        if "id_card" not in data:
            cur.execute("SELECT id_card FROM users WHERE username = ?", (username,))
            r0 = cur.fetchone()
            id_card = r0["id_card"] if r0 else None
        cur.execute("""
            UPDATE users SET display_name = ?, avatar_url = ?, health_info = ?, allergies = ?, medical_history = ?,
                            gender = ?, birthday = ?, height = ?, weight = ?, blood_type = ?, chronic = ?,
                            medications = ?, emergency_name = ?, emergency_phone = ?, insurance = ?, id_card = ?
            WHERE username = ?
        """, (display_name, avatar_url, health_info, allergies, medical_history, gender, birthday, height, weight, blood_type, chronic, medications, emergency_name, emergency_phone, insurance, id_card, username))
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        logging.error(f"更新 profile 失败: {e}", exc_info=True)
        return jsonify({"error": "内部错误"}), 500


@app.route("/upload-avatar", methods=["POST"])
def upload_avatar():
    try:
        if "file" not in request.files:
            return jsonify({"error": "缺少文件"}), 400
        f = request.files["file"]
        if f.filename == "":
            return jsonify({"error": "无效文件名"}), 400
        uploads_dir = os.path.join(repo_root, "server", "uploads")
        os.makedirs(uploads_dir, exist_ok=True)
        # sanitize filename to avoid spaces / unsafe chars
        safe_name = secure_filename(f.filename)
        filename = f"{int(__import__('time').time())}_{safe_name}"
        path = os.path.join(uploads_dir, filename)
        f.save(path)
        url = f"/uploads/{filename}"
        return jsonify({"url": url})
    except Exception as e:
        logging.error(f"上传头像失败: {e}", exc_info=True)
        return jsonify({"error": "上传失败"}), 500


@app.route("/upload-and-analyze", methods=["POST"])
def upload_and_analyze():
    """
    上传图片并自动调用 DeepSeek 或千问 API 进行分析（不使用代理）
    """
    return upload_and_analyze_no_proxy()


@app.route("/upload-image", methods=["POST"])
def upload_image_only():
    """
    只上传图片，不进行分析。返回图片URL供前端显示。
    """
    import os
    from werkzeug.utils import secure_filename

    try:
        if "file" not in request.files:
            return jsonify({"error": "缺少文件"}), 400
        f = request.files["file"]
        if f.filename == "":
            return jsonify({"error": "无效文件名"}), 400

        # 保存图片
        uploads_dir = os.path.join(repo_root, "server", "uploads")
        os.makedirs(uploads_dir, exist_ok=True)
        safe_name = secure_filename(f.filename)
        filename = f"{int(__import__('time').time())}_{safe_name}"
        path = os.path.join(uploads_dir, filename)
        f.save(path)

        # 返回图片URL
        url = f"/uploads/{filename}"
        return jsonify({"url": url}), 200

    except Exception as e:
        logging.error(f"上传图片失败: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/ask_image_stream', methods=['POST'])
def ask_image_stream():
    """
    流式分析图片，使用千问或DeepSeek API，返回格式化后的结果
    """
    import requests
    import os
    import base64
    import mimetypes

    try:
        # 检查是否有文件
        if "file" not in request.files:
            data = request.get_json() or {}
            question = data.get('question', '请分析这张图片中的医学内容并给出建议')
            image_url = data.get('image_url')
        else:
            f = request.files["file"]
            if f.filename == "":
                return jsonify({"error": "无效文件名"}), 400

            # 保存图片
            uploads_dir = os.path.join(repo_root, "server", "uploads")
            os.makedirs(uploads_dir, exist_ok=True)
            safe_name = secure_filename(f.filename)
            filename = f"{int(__import__('time').time())}_{safe_name}"
            path = os.path.join(uploads_dir, filename)
            f.save(path)

            # 读取图片并转换为 base64
            with open(path, 'rb') as img_file:
                img_base64 = base64.b64encode(img_file.read()).decode('utf-8')

            # 获取图片的 MIME 类型
            mime_type, _ = mimetypes.guess_type(path)
            if not mime_type:
                mime_type = 'image/jpeg'

            # 构建 base64 数据 URI
            image_data_uri = f"data:{mime_type};base64,{img_base64}"
            image_url = image_data_uri

            # 获取问题
            data = request.form or {}
            question = data.get('question', '请分析这张图片中的医学内容并给出建议')

        # 判断使用哪个 API
        use_qwen = bool(os.environ.get("DASHSCOPE_API_KEY"))
        api_key = os.environ.get("DASHSCOPE_API_KEY") or os.environ.get("DEEPSEEK_API_KEY")

        if not api_key:
            return jsonify({"error": "请配置 DASHSCOPE_API_KEY 或 DEEPSEEK_API_KEY 环境变量"}), 500

        if use_qwen:
            # 使用千问 API
            chat_path = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
            model = os.environ.get("QWEN_MODEL", "qwen-vl-max-latest")
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": """你是一位专业的医疗影像分析助手。根据图片内容，用最详细、最专业的方式回答。

【重要要求】
1. 回答必须详细、完整，每个要点都要充分展开说明
2. 分段必须清晰，使用清晰的标题和条目
3. 禁止使用特殊符号如 ▶ ○ ● ◆ 等
4. 只描述图片中实际可见的内容，不要编造
5. 回答结构清晰、层次分明，便于阅读

【回答格式】

一、影像概述
对本张影像检查进行总体描述，包括检查类型、拍摄体位等基本信息。

二、主要发现（按部位分节）

（一）肺部表现
• 双肺野透亮度：xxx
• 肺纹理：xxx
• 异常阴影：xxx（如有）
• 结节/肿块：xxx（如有）

（二）心脏与纵隔
• 心脏大小：xxx
• 纵隔：xxx
• 气管：xxx

（三）骨骼系统
• 胸椎：xxx
• 肋骨：xxx
• 其他骨骼：xxx

（四）膈肌与胸膜
• 膈肌：xxx
• 胸腔：xxx

三、诊断意见
根据影像表现给出可能的诊断，区分"未见明显异常"和"需关注的异常"。

四、建议
1. 如需进一步检查，说明建议的检查项目
2. 如需临床结合，给出建议
3. 如需复查，说明复查时机

【排版要求】
• 使用中文数字（一、二、三）和中文括号（（一）（二））
• 使用圆点符号（•）作为列表项
• 每个主要部分之间留出空行
• 段落之间清晰分隔"""},
                    {"role": "user", "content": [
                        {"type": "image_url", "image_url": {"url": image_url}},
                        {"type": "text", "text": question}
                    ]}
                ],
                "stream": False
            }
            logging.info(f"调用千问 API 分析图片（流式输出）")
        else:
            # 使用 DeepSeek API
            endpoint = os.environ.get("DEEPSEEK_ENDPOINT", "https://api.deepseek.com")
            model = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            # DeepSeek 不直接支持图片，需要使用 vision 模型
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": """你是一位专业的医疗影像分析助手。根据图片内容，用最详细、最专业的方式回答。

【重要要求】
1. 回答必须详细、完整，每个要点都要充分展开说明
2. 分段必须清晰，使用清晰的标题和条目
3. 禁止使用特殊符号如 ▶ ○ ● ◆ 等
4. 只描述图片中实际可见的内容，不要编造
5. 回答结构清晰、层次分明，便于阅读

【回答格式】

一、影像概述
对本张影像检查进行总体描述，包括检查类型、拍摄体位等基本信息。

二、主要发现（按部位分节）

（一）肺部表现
• 双肺野透亮度：xxx
• 肺纹理：xxx
• 异常阴影：xxx（如有）
• 结节/肿块：xxx（如有）

（二）心脏与纵隔
• 心脏大小：xxx
• 纵隔：xxx
• 气管：xxx

（三）骨骼系统
• 胸椎：xxx
• 肋骨：xxx
• 其他骨骼：xxx

（四）膈肌与胸膜
• 膈肌：xxx
• 胸腔：xxx

三、诊断意见
根据影像表现给出可能的诊断，区分"未见明显异常"和"需关注的异常"。

四、建议
1. 如需进一步检查，说明建议的检查项目
2. 如需临床结合，给出建议
3. 如需复查，说明复查时机

【排版要求】
• 使用中文数字（一、二、三）和中文括号（（一）（二））
• 使用圆点符号（•）作为列表项
• 每个主要部分之间留出空行
• 段落之间清晰分隔"""},
                    {"role": "user", "content": f"请分析这张图片：{question}"}
                ],
                "stream": False
            }
            logging.info(f"调用 DeepSeek API 分析图片")

        # 调用 API
        resp = requests.post(chat_path, headers=headers, json=payload, timeout=120)
        if not resp.ok:
            return jsonify({"error": f"API 调用失败: {resp.text}"}), 500

        result = resp.json()
        answer = result.get("choices", [{}])[0].get("message", {}).get("content", "")

        # 格式化结果
        formatted_answer = format_analysis_result(answer)

        # 流式输出
        def generate():
            lines = formatted_answer.split('\n')
            for line in lines:
                if line:
                    yield line + '\n'
                else:
                    yield '\n'
                time.sleep(0.02)

        return app.response_class(generate(), mimetype='text/plain; charset=utf-8')

    except Exception as e:
        logging.error(f"图片分析出错: {e}", exc_info=True)
        return jsonify({"error": "分析失败", "details": str(e)}), 500


def format_analysis_result(text):
    """
    格式化分析结果：去除星号、横杆等符号，分段清晰
    """
    import re
    if not text:
        return text

    # 去除星号
    text = text.replace('*', '')
    # 去除横杆（标题下的装饰线如 "----" 或 "——"）
    text = re.sub(r'^[-—=]+$', '', text, flags=re.MULTILINE)
    # 去除多余的空行
    text = re.sub(r'\n{3,}', '\n\n', text)

    # 分段处理：确保每个段落有清晰的标题
    lines = text.split('\n')
    formatted_lines = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # 如果是类似 "1. xxx" 或 "一、xxx" 的标题，保持原样
        # 否则如果是新段落开头，加粗处理（但最终只是文本）
        formatted_lines.append(line)

    return '\n\n'.join(formatted_lines)


def upload_and_analyze_no_proxy():
    """
    上传图片并自动调用 DeepSeek 或千问 API 进行分析（不使用代理）
    """
    import requests
    import os

    try:
        if "file" not in request.files:
            return jsonify({"error": "缺少文件"}), 400
        f = request.files["file"]
        if f.filename == "":
            return jsonify({"error": "无效文件名"}), 400

        # 保存图片
        uploads_dir = os.path.join(repo_root, "server", "uploads")
        os.makedirs(uploads_dir, exist_ok=True)
        safe_name = secure_filename(f.filename)
        filename = f"{int(__import__('time').time())}_{safe_name}"
        path = os.path.join(uploads_dir, filename)
        f.save(path)

        # 读取图片并转换为 base64
        import base64
        with open(path, 'rb') as img_file:
            img_base64 = base64.b64encode(img_file.read()).decode('utf-8')

        # 获取图片的 MIME 类型
        import mimetypes
        mime_type, _ = mimetypes.guess_type(path)
        if not mime_type:
            mime_type = 'image/jpeg'

        # 构建 base64 数据 URI
        image_data_uri = f"data:{mime_type};base64,{img_base64}"

        # 获取可选的问题
        data = request.form or {}
        question = data.get('question', '请分析这张图片中的医学内容并给出建议')

        # 优先使用千问 (DASHSCOPE)，其次使用 DeepSeek
        api_key = os.environ.get("DASHSCOPE_API_KEY") or os.environ.get("DEEPSEEK_API_KEY")

        # 判断使用哪个 API
        use_qwen = bool(os.environ.get("DASHSCOPE_API_KEY"))

        if use_qwen:
            # 使用千问 API
            chat_path = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
            model = os.environ.get("QWEN_MODEL", "qwen-vl-max-latest")
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": "你是一个专业的医疗助手，请根据用户提供的图片进行分析和建议。如果图片是医学相关的（如检查报告、处方、X光片、CT片、化验单等），请给出专业的解读。如果图片不包含医学相关内容，请告知用户并建议提供相关的医学资料。"},
                    {"role": "user", "content": [
                        {"type": "image_url", "image_url": {"url": image_data_uri}},
                        {"type": "text", "text": question}
                    ]}
                ],
                "stream": False
            }
            logging.info(f"调用千问 API 分析图片（base64，不使用代理）")
        else:
            # 使用 DeepSeek API
            api_key = os.environ.get("DEEPSEEK_API_KEY")
            if not api_key:
                return jsonify({"error": "请配置 DASHSCOPE_API_KEY 或 DEEPSEEK_API_KEY 环境变量"}), 500
            endpoint = os.environ.get("DEEPSEEK_ENDPOINT", "https://api.deepseek.com")
            model = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

            chat_path = endpoint.rstrip("/") + "/chat/completions"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": "你是一个专业的医疗助手，请根据用户提供的图片进行分析和建议。如果图片是医学相关的（如检查报告、处方、X光片、CT片、化验单等），请给出专业的解读。如果图片不包含医学相关内容，请告知用户并建议提供相关的医学资料。"},
                    {"role": "user", "content": [
                        {"type": "image_url", "image_url": {"url": image_data_uri}},
                        {"type": "text", "text": question}
                    ]}
                ],
                "stream": False
            }
            logging.info(f"调用 DeepSeek API 分析图片（base64，不使用代理）")

        # 创建一个不使用代理的 session
        session = requests.Session()
        session.trust_env = False  # 禁用代理
        resp = session.post(chat_path, json=payload, headers=headers, timeout=60)
        resp.raise_for_status()
        result = resp.json()

        # 千问和 DeepSeek 的响应格式略有不同
        answer = result.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not answer:
            # 千问可能返回 output.text
            answer = result.get("output", {}).get("text", "")

        if not answer:
            return jsonify({"error": "无法获取分析结果"}), 500

        logging.info(f"图片分析完成: {len(answer)} 字")
        return jsonify({
            "url": f"/uploads/{filename}",
            "answer": answer.strip()
        })

    except requests.exceptions.Timeout:
        logging.error("API 超时")
        return jsonify({"error": "分析超时，请稍后重试"}), 504
    except Exception as e:
        logging.error(f"图片分析失败: {e}", exc_info=True)
        return jsonify({"error": f"分析失败: {str(e)}"}), 500


@app.route("/upload-doctor-license", methods=["POST"])
def upload_doctor_license():
    logging.info(f"Upload doctor license request received")
    logging.info(f"Files in request: {list(request.files.keys())}")
    logging.info(f"Form data: {dict(request.form)}")

    if "file" not in request.files:
        logging.error("No file in request.files")
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    username = request.form.get("username")

    logging.info(f"Username: {username}, Filename: {file.filename}")

    if not username:
        logging.error("Username not provided")
        return jsonify({"error": "Username required"}), 400

    if file.filename == "":
        logging.error("Empty filename")
        return jsonify({"error": "No file selected"}), 400

    # Validate file type (allow common document/image formats)
    allowed_extensions = {"pdf", "jpg", "jpeg", "png", "gif"}
    if "." not in file.filename or file.filename.rsplit(".", 1)[1].lower() not in allowed_extensions:
        logging.error(f"Invalid file type: {file.filename}")
        return jsonify({"error": "Invalid file type. Allowed: PDF, JPG, PNG, GIF"}), 400

    # Create unique filename
    ext = file.filename.rsplit(".", 1)[1].lower()
    filename = f"doctor_license_{username}_{int(__import__('time').time())}.{ext}"

    uploads_dir = os.path.join(repo_root, "server", "uploads")
    os.makedirs(uploads_dir, exist_ok=True)

    file_path = os.path.join(uploads_dir, filename)
    logging.info(f"Saving file to: {file_path}")

    try:
        file.save(file_path)
        logging.info("File saved successfully")
    except Exception as e:
        logging.error(f"Error saving file: {e}")
        return jsonify({"error": f"File save error: {str(e)}"}), 500

    url = f"/uploads/{filename}"
    # Update doctor's license file URL in database (append to existing list, stored as JSON array when possible)
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        logging.info(f"Updating database for username: {username}")
        cur.execute("SELECT license_file_url FROM users_doctor WHERE username = ?", (username,))
        row = cur.fetchone()
        existing = row[0] if row and row[0] else ''
        license_list = []
        try:
            import json as _json
            if existing:
                existing = existing.strip()
                if existing.startswith('['):
                    license_list = _json.loads(existing)
                elif '||' in existing:
                    license_list = [p for p in existing.split('||') if p]
                else:
                    license_list = [existing]
        except Exception:
            license_list = [existing] if existing else []
        license_list.append(url)
        try:
            import json as _json
            stored_value = _json.dumps(license_list, ensure_ascii=False)
        except Exception:
            stored_value = '||'.join(license_list)
        cur.execute(
            "UPDATE users_doctor SET license_file_url = ?, updated_at = ? WHERE username = ?",
            (stored_value, int(__import__("time").time()), username)
        )
        conn.commit()
        logging.info("Database updated successfully (appended license)")
    except Exception as e:
        logging.error(f"Database error: {e}")
        return jsonify({"error": f"Database error: {str(e)}"}), 500
    finally:
        conn.close()

    return jsonify({"message": "License uploaded successfully", "file_url": url}), 200


@app.route("/doctor-profile", methods=["GET"])
def get_doctor_profile():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401

    try:
        data = serializer.loads(token)
        username = data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401

        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT id, username, display_name, avatar_url, clinic, license_number, license_expiry, verified, specialties, bio, phone, created_at, updated_at, license_file_url FROM users_doctor WHERE username = ? AND is_deleted = 0",
            (username,)
        )
        row = cur.fetchone()
        conn.close()

        if not row:
            return jsonify({"error": "Doctor not found"}), 404

        # Convert row to dict and normalize license URLs to a list
        columns = ['id', 'username', 'display_name', 'avatar_url', 'clinic', 'license_number', 'license_expiry', 'verified', 'specialties', 'bio', 'phone', 'created_at', 'updated_at', 'license_file_url']
        doctor_data = dict(zip(columns, row))
        lf = doctor_data.get('license_file_url') or ''
        license_list = []
        try:
            import json as _json
            lf = lf.strip()
            if lf:
                if lf.startswith('['):
                    license_list = _json.loads(lf)
                elif '||' in lf:
                    license_list = [p for p in lf.split('||') if p]
                else:
                    license_list = [lf]
        except Exception:
            license_list = [lf] if lf else []
        doctor_data['license_file_urls'] = license_list
        doctor_data.pop('license_file_url', None)

        return jsonify(doctor_data), 200

    except Exception as e:
        logging.error(f"获取医生资料失败: {e}")
        return jsonify({"error": "获取资料失败"}), 500


@app.route("/doctor-settings", methods=["GET"])
def get_doctor_settings():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401
    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT settings FROM users_doctor WHERE username = ? AND is_deleted = 0", (username,))
        r = cur.fetchone()
        conn.close()
        if not r:
            return jsonify({"error": "Doctor not found"}), 404
        settings_raw = r[0] or '{}'
        try:
            settings = json.loads(settings_raw)
        except Exception:
            settings = {}
        return jsonify({"settings": settings}), 200
    except Exception as e:
        logging.error(f"get_doctor_settings failed: {e}", exc_info=True)
        return jsonify({"error": "获取失败"}), 500


@app.route("/doctor-settings", methods=["POST"])
def post_doctor_settings():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401
    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401
        data = request.get_json() or {}
        # basic validation: allowed keys
        allowed = {
            "notification_email", "work_start", "work_end", "accept_consultations",
            "payment_account", "timezone", "payment_qrcode",
            "show_online_status", "allow_review",
            "email_consultation", "email_prescription", "email_billing"
        }
        settings = {k: v for k, v in data.items() if k in allowed}
        # normalize boolean
        bool_keys = ["accept_consultations", "show_online_status", "allow_review",
                     "email_consultation", "email_prescription", "email_billing"]
        for k in bool_keys:
            if k in settings:
                settings[k] = bool(settings[k])
        # simple validation for times (HH:MM)
        def valid_time(s):
            try:
                if not isinstance(s, str): return False
                parts = s.split(":")
                if len(parts) != 2: return False
                hh = int(parts[0]); mm = int(parts[1])
                return 0 <= hh < 24 and 0 <= mm < 60
            except Exception:
                return False
        if "work_start" in settings and not valid_time(settings["work_start"]):
            return jsonify({"error": "work_start 格式应为 HH:MM"}), 400
        if "work_end" in settings and not valid_time(settings["work_end"]):
            return jsonify({"error": "work_end 格式应为 HH:MM"}), 400

        # persist
        conn = get_db_conn()
        cur = conn.cursor()
        now = int(time.time())
        # upsert settings JSON into users_doctor.settings
        cur.execute("SELECT settings FROM users_doctor WHERE username = ? AND is_deleted = 0", (username,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return jsonify({"error": "Doctor not found"}), 404
        existing_raw = row[0] or '{}'
        try:
            existing = json.loads(existing_raw)
        except Exception:
            existing = {}
        # compute changes diff for audit
        changes = {}
        for k, v in settings.items():
            old = existing.get(k)
            if old != v:
                changes[k] = {"old": old, "new": v}
                existing[k] = v
        cur.execute("UPDATE users_doctor SET settings = ?, updated_at = ? WHERE username = ?", (json.dumps(existing, ensure_ascii=False), now, username))
        # insert audit record if changes
        if changes:
            try:
                cur.execute("INSERT INTO settings_audit (doctor_username, actor, changes, created_at) VALUES (?, ?, ?, ?)", (username, username, json.dumps(changes, ensure_ascii=False), now))
            except Exception:
                logging.exception("failed to write settings audit")
        conn.commit()
        conn.close()
        return jsonify({"ok": True, "settings": existing}), 200
    except Exception as e:
        logging.error(f"post_doctor_settings failed: {e}", exc_info=True)
        return jsonify({"error": "保存失败"}), 500


@app.route("/admin-login", methods=["POST"])
def admin_login():
    try:
        data = request.get_json() or {}
        username = data.get("username", "").strip()
        password = data.get("password", "")
        if not username or not password:
            return jsonify({"error": "必须提供 username 和 password"}), 400

        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT password_hash FROM users WHERE username = ?", (username,))
        r = cur.fetchone()
        conn.close()
        if not r:
            return jsonify({"error": "用户不存在"}), 404
        ph = r["password_hash"]
        if not check_password_hash(ph, password):
            return jsonify({"error": "用户名或密码错误"}), 401
        token = serializer.dumps({"username": username, "role": "admin"})
        return jsonify({"token": token, "username": username}), 200
    except Exception as e:
        logging.error(f"admin_login failed: {e}", exc_info=True)
        return jsonify({"error": "登录失败"}), 500


def admin_auth_username():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token:
        return None
    try:
        data = serializer.loads(token)
        if data.get("role") == "admin":
            return data.get("username")
        return None
    except Exception:
        # allow simple dev token format: admintoken-<username>
        try:
            if token.startswith("admintoken-"):
                return token.split("-", 1)[1]
        except Exception:
            pass
        return None


@app.route("/admin/doctor/<username>", methods=["GET"])
def admin_get_doctor(username):
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT id, username, display_name, avatar_url, clinic, license_number, license_expiry, verified, specialties, bio, phone, created_at, updated_at, license_file_url, is_deleted FROM users_doctor WHERE username = ? AND is_deleted = 0", (username,))
        row = cur.fetchone()
        conn.close()
        if not row:
            return jsonify({"error": "医生不存在"}), 404
        cols = ['id','username','display_name','avatar_url','clinic','license_number','license_expiry','verified','specialties','bio','phone','created_at','updated_at','license_file_url','is_deleted']
        doc = dict(zip(cols, row))
        lf = doc.get('license_file_url') or ''
        license_list = []
        try:
            if lf:
                if lf.startswith('['):
                    license_list = json.loads(lf)
                elif '||' in lf:
                    license_list = [p for p in lf.split('||') if p]
                else:
                    license_list = [lf]
        except Exception:
            license_list = [lf] if lf else []
        doc['license_file_urls'] = license_list
        doc.pop('license_file_url', None)
        return jsonify(doc), 200
    except Exception as e:
        logging.error(f"admin_get_doctor failed: {e}", exc_info=True)
        return jsonify({"error": "获取失败"}), 500


@app.route("/admin/approve-doctor/<username>", methods=["POST"])
def admin_approve_doctor(username):
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        now = int(time.time())
        cur.execute("UPDATE users_doctor SET verified = 1, updated_at = ? WHERE username = ?", (now, username))
        conn.commit()
        conn.close()
        return jsonify({"message": "已通过"}), 200
    except Exception as e:
        logging.error(f"admin_approve_doctor failed: {e}", exc_info=True)
        return jsonify({"error": "审核失败"}), 500


@app.route("/admin/reject-doctor/<username>", methods=["POST"])
def admin_reject_doctor(username):
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        data = request.get_json() or {}
        reason = data.get("reason", "")
        conn = get_db_conn()
        cur = conn.cursor()
        # mark as not verified and add a review record table if needed
        now = int(time.time())
        cur.execute("UPDATE users_doctor SET verified = 0, updated_at = ? WHERE username = ?", (now, username))
        try:
            cur.execute("CREATE TABLE IF NOT EXISTS admin_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, doctor_username TEXT, action TEXT, reason TEXT, admin TEXT, created_at INTEGER)")
        except Exception:
            pass
        cur.execute("INSERT INTO admin_reviews (doctor_username, action, reason, admin, created_at) VALUES (?, ?, ?, ?, ?)", (username, 'reject', reason, admin_user, now))
        conn.commit()
        conn.close()
        return jsonify({"message": "已驳回"}), 200
    except Exception as e:
        logging.error(f"admin_reject_doctor failed: {e}", exc_info=True)
        return jsonify({"error": "驳回失败"}), 500


@app.route("/admin/ban-user/<username>", methods=["POST"])
def admin_ban_user(username):
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        now = int(time.time())
        # set is_deleted flag for doctor if exists
        cur.execute("UPDATE users_doctor SET is_deleted = 1, updated_at = ? WHERE username = ?", (now, username))
        conn.commit()
        conn.close()
        return jsonify({"message": "已封禁"}), 200
    except Exception as e:
        logging.error(f"admin_ban_user failed: {e}", exc_info=True)
        return jsonify({"error": "封禁失败"}), 500


@app.route("/recent-prescriptions", methods=["GET"])
def recent_prescriptions():
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        # scan cases for prescriptions JSON
        cur.execute("SELECT id, prescriptions FROM cases WHERE prescriptions IS NOT NULL ORDER BY updated_at DESC LIMIT 20")
        rows = cur.fetchall()
        out = []
        for r in rows:
            try:
                pres = json.loads(r["prescriptions"]) if r["prescriptions"] else []
            except Exception:
                pres = []
            for p in pres:
                p_copy = dict(p)
                p_copy["_case_id"] = r["id"]
                out.append(p_copy)
        conn.close()
        return jsonify(out), 200
    except Exception as e:
        logging.error(f"recent_prescriptions failed: {e}", exc_info=True)
        return jsonify({"error": "获取失败"}), 500


@app.route("/prescriptions/<prescription_id>", methods=["GET"])
def get_prescription_detail(prescription_id):
    """获取单个处方详情"""
    try:
        conn = get_db_conn()
        conn.row_factory = sqlite3.Row  # 确保使用Row
        cur = conn.cursor()
        # 在所有cases中搜索包含该处方ID的记录
        cur.execute("SELECT id, prescriptions, billings, owner, title, assigned_doctor FROM cases WHERE prescriptions IS NOT NULL")
        rows = cur.fetchall()

        for r in rows:
            r = dict(r)  # 转换为字典
            try:
                prescriptions = json.loads(r["prescriptions"]) if r["prescriptions"] else []
            except Exception:
                prescriptions = []

            for p in prescriptions:
                if p.get("id") == prescription_id:
                    # 找到处方，获取关联的账单信息
                    billings = []
                    try:
                        billings = json.loads(r["billings"]) if r.get("billings") else []
                    except Exception:
                        pass

                    # 查找关联的账单
                    linked_billing = None
                    for b in billings:
                        if b.get("prescription_id") == prescription_id:
                            linked_billing = b
                            break

                    # 获取医生信息
                    doctor_name = r.get("assigned_doctor") or "未知医生"

                    conn.close()
                    return jsonify({
                        "id": p.get("id"),
                        "content": p.get("content", ""),
                        "images": p.get("images", []),
                        "medicines": p.get("medicines", []),
                        "case_id": r["id"],
                        "case_title": r.get("title", ""),
                        "patient": r.get("owner", ""),
                        "doctor": doctor_name,
                        "doctor_name": doctor_name,
                        "billing": linked_billing,
                        "is_paid": linked_billing is not None and linked_billing.get("status") == "paid",
                        "created_at": p.get("created_at")
                    }), 200

        conn.close()
        return jsonify({"error": "处方不存在"}), 404
    except Exception as e:
        logging.error(f"get_prescription_detail failed: {e}", exc_info=True)
        return jsonify({"error": "获取处方详情失败"}), 500


@app.route("/drugs", methods=["GET", "POST"])
def drugs_catalog():
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        if request.method == "POST":
            data = request.get_json() or {}
            name = (data.get("name") or "").strip()
            price = data.get("price", 0) or 0
            unit = (data.get("unit") or "").strip() or "unit"
            if not name:
                conn.close()
                return jsonify({"error": "name required"}), 400
            try:
                price = float(price)
            except Exception:
                price = 0.0
            now = int(time.time())
            cur.execute("INSERT INTO drugs (name, price, unit, created_at) VALUES (?, ?, ?, ?)",
                        (name, price, unit, now))
            conn.commit()
            conn.close()
            return jsonify({"ok": True})

        # GET: support optional query q
        q = (request.args.get("q") or "").strip()
        if q:
            cur.execute("SELECT id, name, price, unit FROM drugs WHERE name LIKE ? ORDER BY name LIMIT 200", (f"%{q}%",))
        else:
            cur.execute("SELECT id, name, price, unit FROM drugs ORDER BY name LIMIT 200")
        rows = cur.fetchall()
        conn.close()
        drugs = [{"id": r[0], "name": r[1], "price": r[2], "unit": r[3]} for r in rows]
        return jsonify({"drugs": drugs})
    except Exception as e:
        logging.error(f"drugs_catalog failed: {e}", exc_info=True)
        return jsonify({"error": "failed"}), 500


@app.route("/drugs/bulk", methods=["POST"])
def drugs_bulk_import():
    """
    Bulk import drugs. Accepts either:
      - JSON body: { "drugs": [ { "name": "...", "price": 1.2, "unit": "tablet" }, ... ] }
      - multipart/form-data with 'file' CSV (name,price,unit header)
    """
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        imported = 0
        # JSON body
        if request.is_json:
            data = request.get_json() or {}
            items = data.get("drugs") or []
            for it in items:
                name = (it.get("name") or "").strip()
                if not name:
                    continue
                try:
                    price = float(it.get("price", 0) or 0)
                except Exception:
                    price = 0.0
                unit = (it.get("unit") or "").strip() or "unit"
                cur.execute("INSERT INTO drugs (name, price, unit, created_at) VALUES (?, ?, ?, ?)",
                            (name, price, unit, int(time.time())))
                imported += 1
            conn.commit()
            conn.close()
            return jsonify({"ok": True, "imported": imported}), 200

        # CSV upload
        if 'file' in request.files:
            f = request.files['file']
            content = f.read().decode('utf-8', errors='ignore')
            lines = [l.strip() for l in content.splitlines() if l.strip()]
            # assume header present
            for i, line in enumerate(lines):
                if i == 0 and ('name' in line.lower() and 'price' in line.lower()):
                    continue
                parts = [p.strip() for p in line.split(',')]
                if not parts:
                    continue
                name = parts[0]
                price = 0.0
                unit = parts[2] if len(parts) > 2 else 'unit'
                if len(parts) > 1:
                    try:
                        price = float(parts[1] or 0)
                    except Exception:
                        price = 0.0
                cur.execute("INSERT INTO drugs (name, price, unit, created_at) VALUES (?, ?, ?, ?)",
                            (name, price, unit, int(time.time())))
                imported += 1
            conn.commit()
            conn.close()
            return jsonify({"ok": True, "imported": imported}), 200

        return jsonify({"error": "no data provided"}), 400
    except Exception as e:
        logging.error(f"drugs_bulk_import failed: {e}", exc_info=True)
        return jsonify({"error": "failed"}), 500


@app.route("/admin/doctors", methods=["GET"])
def admin_list_doctors():
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        # return all non-deleted doctors for admin review
        cur.execute("SELECT username, display_name, avatar_url, clinic, specialties, bio, phone, license_number, verified FROM users_doctor WHERE is_deleted = 0 ORDER BY created_at DESC")
        rows = cur.fetchall()
        conn.close()
        result = []
        for r in rows:
            result.append({
                "username": r[0],
                "display_name": r[1],
                "avatar_url": r[2],
                "clinic": r[3],
                "specialties": r[4],
                "bio": r[5],
                "phone": r[6],
                "license_number": r[7],
                "verified": r[8]
            })
        return jsonify(result), 200
    except Exception as e:
        logging.error(f"admin_list_doctors failed: {e}", exc_info=True)
        return jsonify({"error": "获取失败"}), 500


# ==================== 科室管理 API ====================

@app.route("/admin/departments", methods=["GET"])
def admin_list_departments():
    """获取所有科室列表（管理员用）"""
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT d.id, d.name, d.description, d.icon, d.sort_order, d.created_at,
                   COUNT(DISTINCT dr.username) as doctor_count
            FROM departments d
            LEFT JOIN users_doctor dr ON dr.department_id = d.id AND dr.is_deleted = 0 AND dr.verified = 1
            GROUP BY d.id
            ORDER BY d.sort_order
        """)
        rows = cur.fetchall()
        conn.close()
        result = []
        for r in rows:
            result.append({
                "id": r[0],
                "name": r[1],
                "description": r[2] or "",
                "icon": r[3] or "",
                "sort_order": r[4],
                "created_at": r[5],
                "doctor_count": r[6]
            })
        return jsonify(result), 200
    except Exception as e:
        logging.error(f"admin_list_departments failed: {e}", exc_info=True)
        return jsonify({"error": "获取科室列表失败"}), 500


@app.route("/admin/departments", methods=["POST"])
def admin_create_department():
    """创建新科室"""
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        data = request.get_json() or {}
        name = data.get("name", "").strip()
        if not name:
            return jsonify({"error": "科室名称不能为空"}), 400

        description = data.get("description", "").strip()
        icon = data.get("icon", "").strip()
        sort_order = data.get("sort_order", 0)

        conn = get_db_conn()
        cur = conn.cursor()

        # 检查是否已存在同名科室
        cur.execute("SELECT id FROM departments WHERE name = ?", (name,))
        if cur.fetchone():
            conn.close()
            return jsonify({"error": "科室名称已存在"}), 400

        now = int(time.time())
        cur.execute(
            "INSERT INTO departments (name, description, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
            (name, description, icon, sort_order, now)
        )
        dept_id = cur.lastrowid
        conn.commit()
        conn.close()
        return jsonify({"message": "科室创建成功", "id": dept_id}), 201
    except Exception as e:
        logging.error(f"admin_create_department failed: {e}", exc_info=True)
        return jsonify({"error": "创建科室失败"}), 500


@app.route("/admin/departments/<int:dept_id>", methods=["PUT"])
def admin_update_department(dept_id):
    """更新科室信息"""
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        data = request.get_json() or {}
        name = data.get("name", "").strip()
        if not name:
            return jsonify({"error": "科室名称不能为空"}), 400

        conn = get_db_conn()
        cur = conn.cursor()

        # 检查科室是否存在
        cur.execute("SELECT id FROM departments WHERE id = ?", (dept_id,))
        if not cur.fetchone():
            conn.close()
            return jsonify({"error": "科室不存在"}), 404

        # 检查是否与其他科室名称冲突
        cur.execute("SELECT id FROM departments WHERE name = ? AND id != ?", (name, dept_id))
        if cur.fetchone():
            conn.close()
            return jsonify({"error": "科室名称已存在"}), 400

        description = data.get("description", "").strip()
        icon = data.get("icon", "").strip()
        sort_order = data.get("sort_order", 0)

        cur.execute(
            "UPDATE departments SET name = ?, description = ?, icon = ?, sort_order = ? WHERE id = ?",
            (name, description, icon, sort_order, dept_id)
        )
        conn.commit()
        conn.close()
        return jsonify({"message": "科室更新成功"}), 200
    except Exception as e:
        logging.error(f"admin_update_department failed: {e}", exc_info=True)
        return jsonify({"error": "更新科室失败"}), 500


@app.route("/admin/departments/<int:dept_id>", methods=["DELETE"])
def admin_delete_department(dept_id):
    """删除科室"""
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        conn = get_db_conn()
        cur = conn.cursor()

        # 检查科室是否存在
        cur.execute("SELECT id, name FROM departments WHERE id = ?", (dept_id,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return jsonify({"error": "科室不存在"}), 404

        dept_name = row[1]

        # 检查是否有医生关联到此科室
        cur.execute("SELECT COUNT(*) FROM users_doctor WHERE department_id = ? AND is_deleted = 0", (dept_id,))
        count = cur.fetchone()[0]
        if count > 0:
            conn.close()
            return jsonify({"error": f"该科室下有 {count} 名医生，无法删除"}), 400

        # 检查是否有预约关联到此科室
        cur.execute("SELECT COUNT(*) FROM appointments WHERE department_id = ?", (dept_id,))
        appt_count = cur.fetchone()[0]
        if appt_count > 0:
            conn.close()
            return jsonify({"error": f"该科室有 {appt_count} 条预约记录，无法删除"}), 400

        cur.execute("DELETE FROM departments WHERE id = ?", (dept_id,))
        conn.commit()
        conn.close()
        return jsonify({"message": f"科室 '{dept_name}' 已删除"}), 200
    except Exception as e:
        logging.error(f"admin_delete_department failed: {e}", exc_info=True)
        return jsonify({"error": "删除科室失败"}), 500


@app.route("/admin/departments/<int:dept_id>/doctors", methods=["GET"])
def admin_list_department_doctors(dept_id):
    """获取某科室下的医生列表"""
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT username, display_name, clinic, specialties, verified, phone
            FROM users_doctor
            WHERE department_id = ? AND is_deleted = 0
            ORDER BY verified ASC, created_at DESC
        """, (dept_id,))
        rows = cur.fetchall()
        conn.close()
        result = []
        for r in rows:
            result.append({
                "username": r[0],
                "display_name": r[1] or r[0],
                "clinic": r[2] or "",
                "specialties": r[3] or "",
                "verified": r[4],
                "phone": r[5] or ""
            })
        return jsonify(result), 200
    except Exception as e:
        logging.error(f"admin_list_department_doctors failed: {e}", exc_info=True)
        return jsonify({"error": "获取科室医生列表失败"}), 500


@app.route("/admin/doctors/<username>/department", methods=["PUT"])
def admin_update_doctor_department(username):
    """更新医生的科室"""
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        data = request.get_json() or {}
        department_id = data.get("department_id")

        conn = get_db_conn()
        cur = conn.cursor()

        # 检查医生是否存在
        cur.execute("SELECT id FROM users_doctor WHERE username = ? AND is_deleted = 0", (username,))
        if not cur.fetchone():
            conn.close()
            return jsonify({"error": "医生不存在"}), 404

        # 如果指定了科室，检查科室是否存在
        if department_id is not None:
            cur.execute("SELECT id FROM departments WHERE id = ?", (department_id,))
            if not cur.fetchone():
                conn.close()
                return jsonify({"error": "科室不存在"}), 404

        now = int(time.time())
        cur.execute(
            "UPDATE users_doctor SET department_id = ?, updated_at = ? WHERE username = ?",
            (department_id, now, username)
        )
        conn.commit()
        conn.close()
        return jsonify({"message": "医生科室更新成功"}), 200
    except Exception as e:
        logging.error(f"admin_update_doctor_department failed: {e}", exc_info=True)
        return jsonify({"error": "更新医生科室失败"}), 500


# ==================== 管理员：患者管理 ====================

def _patient_base_where():
    return """(
        COALESCE(u.is_admin, 0) = 0
        AND u.username != '123456789'
    )"""


@app.route("/admin/patients", methods=["GET"])
def admin_list_patients():
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        page = max(1, int(request.args.get("page", 1)))
        per_page = max(1, min(100, int(request.args.get("per_page", 20))))
        offset = (page - 1) * per_page
        q_name = (request.args.get("q_name") or "").strip()
        q_phone = (request.args.get("q_phone") or "").strip()
        q_id = (request.args.get("q_id_card") or "").strip()
        created_from = (request.args.get("created_from") or "").strip()
        created_to = (request.args.get("created_to") or "").strip()

        where = [_patient_base_where()]
        params = []
        if q_name:
            where.append("(u.display_name LIKE ? OR u.username LIKE ?)")
            like = f"%{q_name}%"
            params.extend([like, like])
        if q_phone:
            where.append("(u.emergency_phone LIKE ? OR u.username LIKE ?)")
            likep = f"%{q_phone}%"
            params.extend([likep, likep])
        if q_id:
            where.append("(u.id_card LIKE ?)")
            params.append(f"%{q_id}%")
        if created_from:
            try:
                from datetime import datetime

                ts = int(datetime.strptime(created_from, "%Y-%m-%d").timestamp())
                where.append("u.created_at >= ?")
                params.append(ts)
            except ValueError:
                pass
        if created_to:
            try:
                from datetime import datetime, timedelta

                end = datetime.strptime(created_to, "%Y-%m-%d") + timedelta(days=1)
                where.append("u.created_at < ?")
                params.append(int(end.timestamp()))
            except ValueError:
                pass

        wh = " AND ".join(where)
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(*) FROM users u WHERE {wh}", params)
        total = cur.fetchone()[0]

        cur.execute(
            f"""
            SELECT u.username, u.display_name, u.gender, u.birthday, u.id_card, u.emergency_phone,
                   u.created_at, u.last_login_at, COALESCE(u.is_banned,0), COALESCE(u.is_frozen,0)
            FROM users u
            WHERE {wh}
            ORDER BY u.created_at DESC
            LIMIT ? OFFSET ?
            """,
            params + [per_page, offset],
        )
        rows = cur.fetchall()
        conn.close()

        items = []
        for r in rows:
            items.append(
                {
                    "username": r[0],
                    "display_name": r[1] or "",
                    "gender": r[2] or "",
                    "birthday": r[3] or "",
                    "id_card": r[4] or "",
                    "emergency_phone": r[5] or "",
                    "created_at": r[6],
                    "last_login_at": r[7],
                    "is_banned": bool(r[8]),
                    "is_frozen": bool(r[9]),
                    "account_status": "disabled" if r[8] else ("frozen" if r[9] else "active"),
                }
            )
        return jsonify({"total": total, "page": page, "per_page": per_page, "items": items}), 200
    except Exception as e:
        logging.error(f"admin_list_patients failed: {e}", exc_info=True)
        return jsonify({"error": "获取患者列表失败"}), 500


@app.route("/admin/patients/export", methods=["GET"])
def admin_export_patients():
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        q_name = (request.args.get("q_name") or "").strip()
        q_phone = (request.args.get("q_phone") or "").strip()
        q_id = (request.args.get("q_id_card") or "").strip()
        created_from = (request.args.get("created_from") or "").strip()
        created_to = (request.args.get("created_to") or "").strip()

        where = [_patient_base_where()]
        params = []
        if q_name:
            where.append("(u.display_name LIKE ? OR u.username LIKE ?)")
            like = f"%{q_name}%"
            params.extend([like, like])
        if q_phone:
            where.append("(u.emergency_phone LIKE ? OR u.username LIKE ?)")
            likep = f"%{q_phone}%"
            params.extend([likep, likep])
        if q_id:
            where.append("(u.id_card LIKE ?)")
            params.append(f"%{q_id}%")
        if created_from:
            try:
                from datetime import datetime

                where.append("u.created_at >= ?")
                params.append(int(datetime.strptime(created_from, "%Y-%m-%d").timestamp()))
            except ValueError:
                pass
        if created_to:
            try:
                from datetime import datetime, timedelta

                end = datetime.strptime(created_to, "%Y-%m-%d") + timedelta(days=1)
                where.append("u.created_at < ?")
                params.append(int(end.timestamp()))
            except ValueError:
                pass

        wh = " AND ".join(where)
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT u.username, u.display_name, u.gender, u.birthday, u.id_card,
                   u.emergency_phone, u.emergency_name, u.health_info, u.allergies, u.medical_history,
                   u.created_at, u.last_login_at, COALESCE(u.is_banned,0), COALESCE(u.is_frozen,0)
            FROM users u
            WHERE {wh}
            ORDER BY u.created_at DESC
            """,
            params,
        )
        rows = cur.fetchall()
        conn.close()

        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(
            [
                "用户名",
                "姓名",
                "性别",
                "出生日期",
                "身份证号",
                "联系电话",
                "紧急联系人",
                "健康备注",
                "过敏史",
                "既往病史",
                "注册时间",
                "最后登录",
                "已禁用",
                "已冻结",
            ]
        )
        for r in rows:
            ca = r[10]
            la = r[11]
            w.writerow(
                [
                    r[0],
                    r[1] or "",
                    r[2] or "",
                    r[3] or "",
                    r[4] or "",
                    r[5] or "",
                    r[6] or "",
                    r[7] or "",
                    r[8] or "",
                    r[9] or "",
                    time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ca)) if ca else "",
                    time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(la)) if la else "",
                    "是" if r[12] else "否",
                    "是" if r[13] else "否",
                ]
            )

        data = "\ufeff" + buf.getvalue()
        return Response(
            data.encode("utf-8"),
            mimetype="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="patients_export.csv"'},
        )
    except Exception as e:
        logging.error(f"admin_export_patients failed: {e}", exc_info=True)
        return jsonify({"error": "导出失败"}), 500


@app.route("/admin/patients/<username>", methods=["GET"])
def admin_get_patient(username):
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT username, display_name, avatar_url, health_info, allergies, medical_history,
                   gender, birthday, height, weight, blood_type, chronic, medications,
                   emergency_name, emergency_phone, insurance, id_card, created_at, last_login_at,
                   COALESCE(is_banned,0), COALESCE(is_frozen,0), COALESCE(is_admin,0)
            FROM users u
            WHERE u.username = ? AND {_patient_base_where()}
            """,
            (username,),
        )
        row = cur.fetchone()
        conn.close()
        if not row:
            return jsonify({"error": "患者不存在或无权查看"}), 404
        if row[21]:
            return jsonify({"error": "非患者账号"}), 404
        return jsonify(
            {
                "username": row[0],
                "display_name": row[1],
                "avatar_url": row[2],
                "health_info": row[3],
                "allergies": row[4],
                "medical_history": row[5],
                "gender": row[6],
                "birthday": row[7],
                "height": row[8],
                "weight": row[9],
                "blood_type": row[10],
                "chronic": row[11],
                "medications": row[12],
                "emergency_name": row[13],
                "emergency_phone": row[14],
                "insurance": row[15],
                "id_card": row[16] or "",
                "created_at": row[17],
                "last_login_at": row[18],
                "is_banned": bool(row[19]),
                "is_frozen": bool(row[20]),
            }
        ), 200
    except Exception as e:
        logging.error(f"admin_get_patient failed: {e}", exc_info=True)
        return jsonify({"error": "获取患者详情失败"}), 500


@app.route("/admin/patients/<username>", methods=["PUT"])
def admin_update_patient(username):
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        data = request.get_json() or {}
        allowed = [
            "display_name",
            "gender",
            "birthday",
            "id_card",
            "emergency_name",
            "emergency_phone",
            "health_info",
            "allergies",
            "medical_history",
            "height",
            "weight",
            "blood_type",
            "chronic",
            "medications",
            "insurance",
        ]
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute(
            f"SELECT username FROM users u WHERE u.username = ? AND {_patient_base_where()}",
            (username,),
        )
        if not cur.fetchone():
            conn.close()
            return jsonify({"error": "患者不存在"}), 404

        sets = []
        vals = []
        for k in allowed:
            if k in data:
                sets.append(f"{k} = ?")
                vals.append(data.get(k))
        if not sets:
            conn.close()
            return jsonify({"message": "无变更"}), 200
        vals.append(username)
        cur.execute(f"UPDATE users SET {', '.join(sets)} WHERE username = ?", vals)
        conn.commit()
        conn.close()
        return jsonify({"message": "已保存"}), 200
    except Exception as e:
        logging.error(f"admin_update_patient failed: {e}", exc_info=True)
        return jsonify({"error": "更新失败"}), 500


@app.route("/admin/patients/<username>/status", methods=["POST"])
def admin_patient_status(username):
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        data = request.get_json() or {}
        action = (data.get("action") or "").strip().lower()
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute(
            f"SELECT username FROM users u WHERE u.username = ? AND {_patient_base_where()}",
            (username,),
        )
        if not cur.fetchone():
            conn.close()
            return jsonify({"error": "患者不存在"}), 404

        if action == "enable":
            cur.execute("UPDATE users SET is_banned = 0, is_frozen = 0 WHERE username = ?", (username,))
            msg = "账号已启用"
        elif action == "disable":
            cur.execute("UPDATE users SET is_banned = 1 WHERE username = ?", (username,))
            msg = "账号已禁用"
        elif action == "freeze":
            cur.execute("UPDATE users SET is_frozen = 1 WHERE username = ?", (username,))
            msg = "账号已冻结"
        elif action == "unfreeze":
            cur.execute("UPDATE users SET is_frozen = 0 WHERE username = ?", (username,))
            msg = "账号已解冻"
        else:
            conn.close()
            return jsonify({"error": "无效操作，使用 enable / disable / freeze / unfreeze"}), 400
        conn.commit()
        conn.close()
        return jsonify({"message": msg}), 200
    except Exception as e:
        logging.error(f"admin_patient_status failed: {e}", exc_info=True)
        return jsonify({"error": "操作失败"}), 500


@app.route("/doctor-profile", methods=["POST"])
def update_doctor_profile():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401

    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401

        data = request.get_json() or {}

        # Update doctor profile
        conn = get_db_conn()
        cur = conn.cursor()

        update_fields = []
        update_values = []

        allowed_fields = ['display_name', 'avatar_url', 'clinic', 'license_number', 'license_expiry', 'specialties', 'bio', 'phone', 'license_file_url', 'department_id']
        for field in allowed_fields:
            if field in data:
                update_fields.append(f"{field} = ?")
                update_values.append(data[field])

        if update_fields:
            update_fields.append("updated_at = ?")
            update_values.append(int(__import__("time").time()))
            update_values.append(username)

            query = f"UPDATE users_doctor SET {', '.join(update_fields)} WHERE username = ?"
            cur.execute(query, update_values)
            conn.commit()

        conn.close()

        return jsonify({"message": "资料更新成功"}), 200

    except Exception as e:
        logging.error(f"更新医生资料失败: {e}")
        return jsonify({"error": "更新失败"}), 500


@app.route("/doctor-consultations", methods=["GET"])
def get_doctor_consultations():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401

    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401

        status_filter = request.args.get('status')
        q = (request.args.get('q') or '').strip()
        try:
            page = max(1, int(request.args.get('page', 1)))
        except Exception:
            page = 1
        try:
            per_page = max(1, min(200, int(request.args.get('per_page', 20))))
        except Exception:
            per_page = 20
        offset = (page - 1) * per_page

        conn = get_db_conn()
        cur = conn.cursor()

        base_where = " (c.assigned_doctor = ? OR (c.status = 'pending' AND c.assigned_doctor IS NULL)) "
        # 过滤掉 AI 智能问答的记录
        base_where += " AND (c.source IS NULL OR c.source = 'manual' OR c.source = '') "
        params = [username]
        if status_filter and status_filter != 'all':
            base_where += " AND c.status = ? "
            params.append(status_filter)
        if q:
            # search across several fields
            like_q = f"%{q}%"
            base_where += " AND (c.id LIKE ? OR c.title LIKE ? OR c.symptoms LIKE ? OR u.display_name LIKE ? OR c.owner LIKE ?) "
            params.extend([like_q, like_q, like_q, like_q, like_q])

        # count total
        count_query = f"SELECT COUNT(*) FROM cases c LEFT JOIN users u ON c.owner = u.username WHERE {base_where}"
        cur.execute(count_query, params)
        total = cur.fetchone()[0] if cur and cur.fetchone() is None else None
        # NOTE: fetchone() consumed the cursor; re-run count correctly
        try:
            cur.execute(count_query, params)
            total = cur.fetchone()[0]
        except Exception:
            total = None

        query = f"""
            SELECT c.id, c.owner, c.title, c.messages, c.created_at, c.updated_at,
                   c.status, c.assigned_doctor, c.symptoms, c.diagnosis, c.completed_at,
                   u.display_name as patient_name, c.prescriptions
            FROM cases c
            LEFT JOIN users u ON c.owner = u.username
            WHERE {base_where}
            ORDER BY c.created_at DESC
            LIMIT ? OFFSET ?
        """
        params_with_limit = params + [per_page, offset]
        cur.execute(query, params_with_limit)
        rows = cur.fetchall()
        # fetch favorites for this doctor to annotate results
        try:
            cur.execute("CREATE TABLE IF NOT EXISTS favorites (doctor_username TEXT, case_id TEXT, created_at INTEGER)")
        except Exception:
            pass
        fav_ids = set()
        try:
            cur2 = conn.cursor()
            cur2.execute("SELECT case_id FROM favorites WHERE doctor_username = ?", (username,))
            fav_rows = cur2.fetchall()
            fav_ids = set([r[0] for r in fav_rows])
        except Exception:
            fav_ids = set()
        finally:
            try:
                cur2.close()
            except Exception:
                pass
        conn.close()

        # Convert rows to dict
        columns = ['id', 'owner', 'title', 'messages', 'created_at', 'updated_at',
                  'status', 'assigned_doctor', 'symptoms', 'diagnosis', 'completed_at', 'patient_name', 'prescriptions']
        consultations = []
        for row in rows:
            item = dict(zip(columns, row))
            item['favorite'] = item['id'] in fav_ids
            # attach tags placeholder, will populate below
            item['tags'] = []
            # 从prescriptions中提取最新处方的ID
            item['prescription_id'] = None
            try:
                if item.get('prescriptions'):
                    pres_list = json.loads(item['prescriptions']) if isinstance(item['prescriptions'], str) else item['prescriptions']
                    if pres_list and len(pres_list) > 0:
                        item['prescription_id'] = pres_list[-1].get('id')
            except Exception:
                pass
            consultations.append(item)

        # fetch tags for returned case ids
        try:
            case_ids = [c['id'] for c in consultations]
            if case_ids:
                qmarks = ",".join("?" for _ in case_ids)
                conn2 = get_db_conn()
                cur2 = conn2.cursor()
                cur2.execute(f"SELECT case_id, tag FROM case_tags WHERE case_id IN ({qmarks})", tuple(case_ids))
                tag_rows = cur2.fetchall()
                conn2.close()
                tag_map = {}
                for r in tag_rows:
                    cid = r[0]; tag = r[1]
                    tag_map.setdefault(cid, []).append(tag)
                for c in consultations:
                    c['tags'] = tag_map.get(c['id'], [])
        except Exception:
            pass

        return jsonify(consultations), 200

    except Exception as e:
        logging.error(f"获取医生接诊列表失败: {e}")
        return jsonify({"error": "获取列表失败"}), 500


@app.route("/accept-consultation/<case_id>", methods=["POST"])
def accept_consultation(case_id):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401

    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401

        conn = get_db_conn()
        cur = conn.cursor()

        # Check if case exists and is available
        cur.execute("SELECT status, assigned_doctor FROM cases WHERE id = ?", (case_id,))
        case = cur.fetchone()

        if not case:
            conn.close()
            logging.warning(f"accept_consultation: case not found {case_id}")
            return jsonify({"error": "病例不存在"}), 404

        status = case[0]
        assigned_doc = case[1]
        # Only allow accepting if status is 'pending'
        if status != 'pending':
            conn.close()
            logging.info(f"accept_consultation: cannot accept case {case_id}, status={status}")
            return jsonify({"error": "该病例当前状态不可接诊", "status": status}), 400
        # If assigned_doctor set to someone else, block; if assigned to this doctor (requested), allow
        if assigned_doc is not None and assigned_doc != username:
            conn.close()
            logging.info(f"accept_consultation: case {case_id} already assigned to {assigned_doc}")
            return jsonify({"error": "该病例已被其他医生接诊"}), 400

        # Create a new child case for doctor-patient chat, keep original as reference
        try:
            # fetch original case owner/title
            cur.execute("SELECT owner, title FROM cases WHERE id = ?", (case_id,))
            orig = cur.fetchone()
            if not orig:
                conn.close()
                return jsonify({"error": "原病例不存在"}), 404
            owner = orig["owner"]
            title = orig["title"] or "病例咨询"
            now = int(time.time())
            # create new case id
            new_cid = f"case-{now}-{int(time.time()*1000)%1000}"
            messages_json = json.dumps([], ensure_ascii=False)
            cur.execute("INSERT INTO cases (id, owner, title, messages, created_at, updated_at, status, assigned_doctor, parent_case_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (new_cid, owner, title, messages_json, now, now, 'active', username, case_id))
            # update original case status to assigned (keep as record)
            cur.execute("UPDATE cases SET status = 'assigned', updated_at = ? WHERE id = ?", (now, case_id))
            conn.commit()
            conn.close()
            return jsonify({"message": "接诊成功", "new_case_id": new_cid}), 200
        except Exception as e:
            logging.error(f"创建子会话失败: {e}", exc_info=True)
            conn.rollback()
            conn.close()
            return jsonify({"error": "接诊失败"}), 500

    except Exception as e:
        logging.error(f"接受接诊失败: {e}")
        return jsonify({"error": "接诊失败"}), 500


@app.route("/check-in/<case_id>", methods=["POST"])
def check_in_appointment(case_id):
    """医生签到接诊（用于预约病例）"""
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "请先登录"}), 401

    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "无效token"}), 401

        conn = get_db_conn()
        cur = conn.cursor()

        # 检查病例是否存在
        cur.execute("SELECT status, assigned_doctor FROM cases WHERE id = ?", (case_id,))
        case = cur.fetchone()

        if not case:
            conn.close()
            return jsonify({"error": "病例不存在"}), 404

        status = case[0]
        assigned_doc = case[1]

        # 如果已分配给其他医生（且不是空字符串），不允许签到
        if assigned_doc and assigned_doc != username:
            conn.close()
            return jsonify({"error": "该病例已被其他医生接诊"}), 400

        now = int(time.time())

        # 更新病例状态为 active
        cur.execute("UPDATE cases SET status = 'active', assigned_doctor = ?, updated_at = ? WHERE id = ?",
                    (username, now, case_id))

        conn.commit()
        conn.close()

        return jsonify({"message": "签到成功", "case_id": case_id}), 200

    except Exception as e:
        logging.error(f"签到失败: {e}")
        return jsonify({"error": "签到失败"}), 500


@app.route("/cases/<case_id>/favorite", methods=["POST"])
def favorite_case(case_id):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401
    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401
        # only doctors can favorite
        if token_data.get('user_type') != 'doctor' and token_data.get('role') != 'doctor':
            return jsonify({"error": "Only doctors can favorite cases"}), 403
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("CREATE TABLE IF NOT EXISTS favorites (doctor_username TEXT, case_id TEXT, created_at INTEGER)")
        cur.execute("SELECT 1 FROM favorites WHERE doctor_username = ? AND case_id = ?", (username, case_id))
        if cur.fetchone():
            conn.close()
            return jsonify({"message": "already favorited"}), 200
        cur.execute("INSERT INTO favorites (doctor_username, case_id, created_at) VALUES (?, ?, ?)", (username, case_id, int(time.time())))
        conn.commit()
        conn.close()
        return jsonify({"message": "favorited"}), 200
    except Exception as e:
        logging.error(f"favorite_case failed: {e}", exc_info=True)
        return jsonify({"error": "操作失败"}), 500


@app.route("/cases/<case_id>/favorite", methods=["DELETE"])
def unfavorite_case(case_id):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401
    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("DELETE FROM favorites WHERE doctor_username = ? AND case_id = ?", (username, case_id))
        conn.commit()
        conn.close()
        return jsonify({"message": "unfavorited"}), 200
    except Exception as e:
        logging.error(f"unfavorite_case failed: {e}", exc_info=True)
        return jsonify({"error": "操作失败"}), 500


@app.route("/doctor/<username>/favorites", methods=["GET"])
def get_doctor_favorites(username):
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("CREATE TABLE IF NOT EXISTS favorites (doctor_username TEXT, case_id TEXT, created_at INTEGER)")
        cur.execute("SELECT case_id FROM favorites WHERE doctor_username = ?", (username,))
        rows = cur.fetchall()
        conn.close()
        return jsonify([r[0] for r in rows]), 200
    except Exception as e:
        logging.error(f"get_doctor_favorites failed: {e}", exc_info=True)
        return jsonify({"error": "获取失败"}), 500


@app.route("/cases/<case_id>/tags", methods=["GET"])
def get_case_tags(case_id):
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("CREATE TABLE IF NOT EXISTS case_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT, tag TEXT, created_at INTEGER)")
        cur.execute("SELECT tag FROM case_tags WHERE case_id = ?", (case_id,))
        rows = cur.fetchall()
        conn.close()
        return jsonify([r[0] for r in rows]), 200
    except Exception as e:
        logging.error(f"get_case_tags failed: {e}", exc_info=True)
        return jsonify({"error": "获取失败"}), 500


@app.route("/cases/<case_id>/tags", methods=["POST"])
def add_case_tag(case_id):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401
    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        # only doctors can tag cases
        if token_data.get('user_type') != 'doctor' and token_data.get('role') != 'doctor':
            return jsonify({"error": "Only doctors can tag cases"}), 403
        data = request.get_json() or {}
        tag = (data.get('tag') or '').strip()
        if not tag:
            return jsonify({"error": "tag 不能为空"}), 400
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("CREATE TABLE IF NOT EXISTS case_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT, tag TEXT, created_at INTEGER)")
        # prevent duplicate tag for same case
        cur.execute("SELECT 1 FROM case_tags WHERE case_id = ? AND tag = ?", (case_id, tag))
        if cur.fetchone():
            conn.close()
            return jsonify({"message": "already tagged"}), 200
        cur.execute("INSERT INTO case_tags (case_id, tag, created_at) VALUES (?, ?, ?)", (case_id, tag, int(time.time())))
        conn.commit()
        conn.close()
        return jsonify({"message": "tag added"}), 200
    except Exception as e:
        logging.error(f"add_case_tag failed: {e}", exc_info=True)
        return jsonify({"error": "操作失败"}), 500


@app.route("/cases/<case_id>/tags/<tag>", methods=["DELETE"])
def remove_case_tag(case_id, tag):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401
    try:
        token_data = serializer.loads(token)
        # only doctors can remove tags
        if token_data.get('user_type') != 'doctor' and token_data.get('role') != 'doctor':
            return jsonify({"error": "Only doctors can remove tags"}), 403
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("DELETE FROM case_tags WHERE case_id = ? AND tag = ?", (case_id, tag))
        conn.commit()
        conn.close()
        return jsonify({"message": "tag removed"}), 200
    except Exception as e:
        logging.error(f"remove_case_tag failed: {e}", exc_info=True)
        return jsonify({"error": "操作失败"}), 500


@app.route("/tags", methods=["GET"])
def list_tags():
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("CREATE TABLE IF NOT EXISTS case_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT, tag TEXT, created_at INTEGER)")
        cur.execute("SELECT tag, COUNT(*) as cnt FROM case_tags GROUP BY tag ORDER BY cnt DESC")
        rows = cur.fetchall()
        conn.close()
        return jsonify([{"tag": r[0], "count": r[1]} for r in rows]), 200
    except Exception as e:
        logging.error(f"list_tags failed: {e}", exc_info=True)
        return jsonify({"error": "获取失败"}), 500


@app.route("/complete-consultation/<case_id>", methods=["POST"])
def complete_consultation(case_id):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401

    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401

        data = request.get_json() or {}
        diagnosis = data.get('diagnosis', '')

        conn = get_db_conn()
        cur = conn.cursor()

        # Check if case belongs to this doctor
        cur.execute("SELECT assigned_doctor FROM cases WHERE id = ?", (case_id,))
        case = cur.fetchone()

        if not case or case[0] != username:
            conn.close()
            return jsonify({"error": "无权操作此病例"}), 403

        # Complete the consultation
        cur.execute(
            "UPDATE cases SET status = 'completed', diagnosis = ?, completed_at = ?, updated_at = ? WHERE id = ?",
            (diagnosis, int(__import__("time").time()), int(__import__("time").time()), case_id)
        )
        conn.commit()
        conn.close()

        return jsonify({"message": "病例完成"}), 200

    except Exception as e:
        logging.error(f"完成接诊失败: {e}")
        return jsonify({"error": "完成失败"}), 500


@app.route("/patient-info/<username>", methods=["GET"])
def get_patient_info(username):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401

    try:
        token_data = serializer.loads(token)
        token_user = token_data.get('username')
        token_role = token_data.get('role')
        if not token_user:
            return jsonify({"error": "Invalid token"}), 401

        conn = get_db_conn()
        cur = conn.cursor()
        # Admins can access any patient info, patients can access their own info
        if token_role == 'admin' or token_user == username:
            has_access = True
        else:
            # Check if this doctor has access to this patient's cases
            cur.execute("SELECT COUNT(*) FROM cases WHERE owner = ? AND assigned_doctor = ?", (username, token_user))
            has_access = cur.fetchone()[0] > 0

        if not has_access:
            conn.close()
            return jsonify({"error": "无权访问此患者信息"}), 403

        # Get patient info
        cur.execute("""
            SELECT username, display_name, avatar_url, health_info, allergies, medical_history,
                   gender, birthday, height, weight, blood_type, chronic, medications,
                   emergency_name, emergency_phone, insurance, id_card
            FROM users WHERE username = ?
        """, (username,))
        row = cur.fetchone()
        conn.close()

        if not row:
            return jsonify({"error": "患者不存在"}), 404

        return jsonify({
            "username": row["username"],
            "display_name": row["display_name"],
            "avatar_url": row["avatar_url"],
            "health_info": row["health_info"],
            "allergies": row["allergies"],
            "medical_history": row["medical_history"],
            "gender": row["gender"],
            "birthday": row["birthday"],
            "height": row["height"],
            "weight": row["weight"],
            "blood_type": row["blood_type"],
            "chronic": row["chronic"],
            "medications": row["medications"],
            "emergency_name": row["emergency_name"],
            "emergency_phone": row["emergency_phone"],
            "insurance": row["insurance"],
            "id_card": row["id_card"] or ""
        })

    except Exception as e:
        logging.error(f"获取患者信息失败: {e}")
        return jsonify({"error": "获取信息失败"}), 500


@app.route("/cases/<case_id>/message", methods=["POST"])
def send_case_message(case_id):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401

    try:
        # parse token and log for debugging
        try:
            token_data = serializer.loads(token)
        except Exception as e:
            logging.error(f"send_case_message: invalid token: {e}")
            return jsonify({"error": "Invalid token"}), 401

        username = token_data.get('username')
        if not username:
            logging.error("send_case_message: token missing username")
            return jsonify({"error": "Invalid token"}), 401

        data = request.get_json() or {}
        message = data.get('message')
        if not message:
            return jsonify({"error": "消息不能为空"}), 400

        # Log incoming request details for debugging
        try:
            logging.info("send_case_message: incoming request")
            logging.info(f"  Authorization header present: {'Authorization' in request.headers}")
            logging.info(f"  token username: {username}")
            logging.info(f"  token raw data: {token_data}")
            logging.info(f"  incoming message (raw): {message}")
        except Exception:
            logging.exception("send_case_message: logging incoming request failed")

        conn = get_db_conn()
        cur = conn.cursor()

        # Check if case exists and user has access
        cur.execute("SELECT owner, assigned_doctor, messages, chat_banned FROM cases WHERE id = ?", (case_id,))
        case = cur.fetchone()

        if not case:
            conn.close()
            logging.warning(f"send_case_message: case not found: {case_id}")
            return jsonify({"error": "病例不存在"}), 404

        owner = case[0]
        assigned = case[1]
        chat_banned = False
        try:
            # sqlite row may be indexable by key or tuple
            chat_banned = bool(case['chat_banned']) if isinstance(case, dict) or hasattr(case, 'keys') else bool(case[3])
        except Exception:
            chat_banned = False
        if chat_banned:
            conn.close()
            logging.warning(f"send_case_message: case {case_id} is chat_banned")
            return jsonify({"error": "该会话已被封禁聊天"}), 403
        # Check if user is either the patient or the assigned doctor
        is_patient = owner == username
        is_doctor = (assigned == username)

        logging.info(f"send_case_message: case_id={case_id}, owner={owner}, assigned_doctor={assigned}, sender={username}, is_patient={is_patient}, is_doctor={is_doctor}")

        if not (is_patient or is_doctor):
            conn.close()
            logging.warning(f"send_case_message: unauthorized user {username} for case {case_id}")
            return jsonify({"error": "无权访问此病例"}), 403

        # Load current messages safely
        messages_json = case[2] or "[]"
        try:
            current_messages = json.loads(messages_json) if messages_json else []
        except Exception:
            current_messages = []

        # Normalize incoming message and set role based on authenticated user
        if isinstance(message, dict):
            msg = dict(message)
        else:
            msg = {"content": str(message)}

        token_role = token_data.get('user_type') or token_data.get('role')
        # Prioritize explicit ownership/assignment:
        # - If sender is the assigned doctor -> doctor
        # - Else if sender is the case owner (patient) -> user
        # - Else fall back to token_role (e.g., admin/dev tokens)
        if is_doctor:
            msg['role'] = 'doctor'
        elif is_patient:
            msg['role'] = 'user'
        else:
            if token_role == 'doctor':
                msg['role'] = 'doctor'
            else:
                msg['role'] = 'user'

        # ensure id and timestamp
        if 'id' not in msg:
            msg['id'] = f"m{int(time.time()*1000)}"
        if 'ts' not in msg:
            msg['ts'] = int(time.time())

        # if message content field is named 'content' or 'text', normalize to 'content'
        if 'text' in msg and 'content' not in msg:
            msg['content'] = msg.pop('text')

        # Log decided role before persisting
        logging.info(f"send_case_message: prepared message id={msg.get('id')} role={msg.get('role')} ts={msg.get('ts')}")

        # Add new message
        updated_messages = current_messages + [msg]

        # Update messages (convert to JSON string)
        updated_messages_json = json.dumps(updated_messages, ensure_ascii=False)
        cur.execute(
            "UPDATE cases SET messages = ?, updated_at = ? WHERE id = ?",
            (updated_messages_json, int(time.time()), case_id)
        )
        conn.commit()
        conn.close()

        logging.info(f"send_case_message: message stored for case {case_id}")
        return jsonify({"message": "消息发送成功"}), 200

    except Exception as e:
        logging.error(f"发送消息失败: {e}")
        return jsonify({"error": "发送失败"}), 500


@app.route("/cases/<case_id>/prescription", methods=["POST"])
def submit_prescription(case_id):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401

    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401

        data = request.get_json() or {}
        # support prescription as either a simple string or structured object
        pres_input = data.get('prescription')
        if pres_input is None:
            return jsonify({"error": "处方内容不能为空"}), 400
        if isinstance(pres_input, dict):
            prescription_text = pres_input.get('content', '').strip()
            prescription_images = pres_input.get('images', []) or []
            prescription_medicines = pres_input.get('medicines', []) or []
        else:
            prescription_text = str(pres_input).strip()
            prescription_images = []
            prescription_medicines = []
        if not prescription_text:
            return jsonify({"error": "处方内容不能为空"}), 400

        conn = get_db_conn()
        cur = conn.cursor()

        # Check if case belongs to this doctor
        cur.execute("SELECT assigned_doctor FROM cases WHERE id = ?", (case_id,))
        case = cur.fetchone()

        if not case or case[0] != username:
            conn.close()
            return jsonify({"error": "无权操作此病例"}), 403

        # Get current prescriptions or initialize
        cur.execute("SELECT prescriptions FROM cases WHERE id = ?", (case_id,))
        result = cur.fetchone()
        prescriptions_json = result[0] if result[0] else "[]"
        try:
            current_prescriptions = json.loads(prescriptions_json) if prescriptions_json else []
        except Exception:
            current_prescriptions = []

        # Add new prescription
        new_prescription = {
            "id": f"prescription-{int(__import__('time').time())}-{int(__import__('time').time()*1000)%1000}",
            "content": prescription_text,
            "images": prescription_images,
            "medicines": prescription_medicines,
            "created_at": int(__import__("time").time()),
            "doctor": username
        }
        updated_prescriptions = current_prescriptions + [new_prescription]

        # Also append a prescription-type message into messages so it shows in chat
        try:
            cur.execute("SELECT messages FROM cases WHERE id = ?", (case_id,))
            row = cur.fetchone()
            messages_json = row[0] if row and row[0] else "[]"
            try:
                current_messages = json.loads(messages_json) if messages_json else []
            except Exception:
                current_messages = []
        except Exception:
            current_messages = []

        # Do not append full prescription details into messages visible to patient.
        # Append a short placeholder message referencing the prescription id and billing.
        pres_msg = {
            "id": f"m_presc_{int(__import__('time').time()*1000)}",
            "role": "doctor",
            "type": "prescription_pending",
            "content": f"处方已开具（ID: {new_prescription['id']}），请支付账单后查看详细处方。",
            "prescription_id": new_prescription["id"],
            "ts": int(__import__("time").time())
        }
        updated_messages = current_messages + [pres_msg]

        # Optionally compute billing: visit fee + medicines total
        visit_fee = 0.0
        try:
            visit_fee = float(data.get("visit_fee", 0) or 0)
        except Exception:
            visit_fee = 0.0

        # compute medicine total if medicines are detailed objects
        medicine_total = 0.0
        detailed_medicines = []
        for m in prescription_medicines:
            if isinstance(m, dict):
                name = m.get("name") or m.get("title") or ""
                price = 0.0
                qty = 1
                try:
                    price = float(m.get("price", 0) or 0)
                except Exception:
                    price = 0.0
                try:
                    qty = int(m.get("qty", 1) or 1)
                except Exception:
                    qty = 1
                subtotal = price * qty
                medicine_total += subtotal
                detailed_medicines.append({"name": name, "price": price, "qty": qty, "subtotal": subtotal})
            else:
                # string name only
                detailed_medicines.append({"name": str(m), "price": 0.0, "qty": 1, "subtotal": 0.0})

        total_amount = round(float(visit_fee) + float(medicine_total), 2)

        # Create billing record tied to this prescription
        # Get current billings or initialize
        cur.execute("SELECT billings FROM cases WHERE id = ?", (case_id,))
        billings_row = cur.fetchone()
        billings_json = billings_row[0] if billings_row and billings_row[0] else "[]"
        try:
            current_billings = json.loads(billings_json) if billings_json else []
        except Exception:
            current_billings = []

        new_billing = {
            "id": f"billing-{int(__import__('time').time())}-{int(__import__('time').time()*1000)%1000}",
            "amount": total_amount,
            "description": f"处方费用（诊疗费 {visit_fee} + 药品 {medicine_total}）",
            "created_at": int(__import__("time").time()),
            "doctor": username,
            "status": "pending",
            "prescription_id": new_prescription["id"]
        }
        updated_billings = current_billings + [new_billing]

        # Append billing notification message
        billing_msg = {
            "id": f"m_billing_{int(__import__('time').time()*1000)}",
            "role": "doctor",
            "type": "billing",
            "content": f"已生成处方账单，请支付 {total_amount} 元",
            "billing_id": new_billing["id"],
            "amount": total_amount,
            "ts": int(__import__("time").time())
        }
        updated_messages = current_messages + [pres_msg, billing_msg]

        # Persist prescriptions, billings and messages
        updated_prescriptions_json = json.dumps(updated_prescriptions, ensure_ascii=False)
        updated_billings_json = json.dumps(updated_billings, ensure_ascii=False)
        updated_messages_json = json.dumps(updated_messages, ensure_ascii=False)
        cur.execute(
            "UPDATE cases SET prescriptions = ?, billings = ?, messages = ?, updated_at = ? WHERE id = ?",
            (updated_prescriptions_json, updated_billings_json, updated_messages_json, int(__import__("time").time()), case_id)
        )
        conn.commit()
        conn.close()

        return jsonify({"message": "处方提交成功", "billing_id": new_billing["id"], "amount": total_amount}), 200

    except Exception as e:
        logging.error(f"提交处方失败: {e}")
        return jsonify({"error": "提交失败"}), 500


@app.route("/cases/<case_id>/billing", methods=["POST"])
def submit_billing(case_id):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401

    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401

        data = request.get_json() or {}
        amount = data.get('amount')
        description = data.get('description', '').strip()

        if not amount or not description:
            return jsonify({"error": "金额和描述都不能为空"}), 400

        try:
            amount = float(amount)
            if amount <= 0:
                return jsonify({"error": "金额必须大于0"}), 400
        except ValueError:
            return jsonify({"error": "金额格式不正确"}), 400

        conn = get_db_conn()
        cur = conn.cursor()

        # Check if case belongs to this doctor
        cur.execute("SELECT assigned_doctor FROM cases WHERE id = ?", (case_id,))
        case = cur.fetchone()

        if not case or case[0] != username:
            conn.close()
            return jsonify({"error": "无权操作此病例"}), 403

        # Get current billings or initialize
        cur.execute("SELECT billings FROM cases WHERE id = ?", (case_id,))
        result = cur.fetchone()
        billings_json = result[0] if result[0] else "[]"
        try:
            current_billings = json.loads(billings_json) if billings_json else []
        except Exception:
            current_billings = []

        # Add new billing
        new_billing = {
            "id": f"billing-{int(__import__('time').time())}-{int(__import__('time').time()*1000)%1000}",
            "amount": amount,
            "description": description,
            "created_at": int(__import__("time").time()),
            "doctor": username
        }
        updated_billings = current_billings + [new_billing]

        # Also append a billing-type message into messages so it shows in chat
        try:
            cur.execute("SELECT messages FROM cases WHERE id = ?", (case_id,))
            row = cur.fetchone()
            messages_json = row[0] if row and row[0] else "[]"
            try:
                current_messages = json.loads(messages_json) if messages_json else []
            except Exception:
                current_messages = []
        except Exception:
            current_messages = []

        billing_msg = {
            "id": f"m_billing_{int(__import__('time').time()*1000)}",
            "role": "doctor",
            "type": "billing",
            "content": f"请支付费用：{amount}元 - {description}",
            "billing_id": new_billing["id"],
            "amount": amount,
            "ts": int(__import__("time").time())
        }

        updated_messages = current_messages + [billing_msg]

        # Update billings and messages (convert to JSON string)
        updated_billings_json = json.dumps(updated_billings, ensure_ascii=False)
        updated_messages_json = json.dumps(updated_messages, ensure_ascii=False)
        cur.execute(
            "UPDATE cases SET billings = ?, messages = ?, updated_at = ? WHERE id = ?",
            (updated_billings_json, updated_messages_json, int(__import__("time").time()), case_id)
        )
        conn.commit()
        conn.close()

        return jsonify({"message": "收费提交成功"}), 200
    except Exception as e:
        logging.error(f"提交收费失败: {e}", exc_info=True)
        return jsonify({"error": "提交失败"}), 500


@app.route("/cases/<case_id>/billing/<billing_id>/pay", methods=["POST"])
def pay_billing(case_id, billing_id):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401
    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401
        data = request.get_json() or {}
        method = data.get('method', 'unknown')

        conn = get_db_conn()
        cur = conn.cursor()
        # load billings and messages
        cur.execute("SELECT owner, billings, messages FROM cases WHERE id = ?", (case_id,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return jsonify({"error": "病例不存在"}), 404
        owner = row[0]
        billings_json = row[1] or "[]"
        messages_json = row[2] or "[]"
        try:
            billings = json.loads(billings_json)
        except Exception:
            billings = []
        try:
            messages = json.loads(messages_json)
        except Exception:
            messages = []

        # only patient (owner) or admin can mark paid
        token_role = token_data.get('user_type') or token_data.get('role')
        if username != owner and token_role != 'admin':
            conn.close()
            return jsonify({"error": "无权支付此账单"}), 403

        # find billing
        found = False
        for b in billings:
            if b.get('id') == billing_id:
                b['status'] = 'paid'
                b['paid_at'] = int(time.time())
                b['paid_by'] = username
                b['payment_method'] = method
                found = True
                break
        if not found:
            conn.close()
            return jsonify({"error": "账单未找到"}), 404

        # append a payment confirmation message
        pay_msg = {
            "id": f"m_pay_{int(time.time()*1000)}",
            "role": "system",
            "type": "billing_paid",
            "content": f"已通过 {method} 支付 {billing_id}",
            "billing_id": billing_id,
            "ts": int(time.time())
        }
        messages.append(pay_msg)

        # If there's a prescription linked to this billing, reveal full prescription by appending it to messages
        try:
            # load prescriptions for this case
            cur.execute("SELECT prescriptions FROM cases WHERE id = ?", (case_id,))
            pres_row = cur.fetchone()
            pres_json = pres_row[0] if pres_row and pres_row[0] else "[]"
            try:
                prescriptions = json.loads(pres_json)
            except Exception:
                prescriptions = []
            # find billing's linked prescription_id
            linked_pres_id = None
            for b in billings:
                if b.get('id') == billing_id:
                    linked_pres_id = b.get('prescription_id')
                    break
            if linked_pres_id:
                for p in prescriptions:
                    if p.get('id') == linked_pres_id:
                        full_pres_msg = {
                            "id": f"m_presc_full_{int(time.time()*1000)}",
                            "role": "doctor",
                            "type": "prescription",
                            "content": p.get("content"),
                            "images": p.get("images", []),
                            "medicines": p.get("medicines", []),
                            "ts": int(time.time())
                        }
                        messages.append(full_pres_msg)
                        break
        except Exception:
            # ignore errors here but ensure we still persist payment
            logging.exception("revealing prescription after payment failed")

        # persist
        cur.execute("UPDATE cases SET billings = ?, messages = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(billings, ensure_ascii=False), json.dumps(messages, ensure_ascii=False), int(time.time()), case_id))
        conn.commit()
        conn.close()
        return jsonify({"message": "支付成功"}), 200
    except Exception as e:
        logging.error(f"支付失败: {e}", exc_info=True)
        return jsonify({"error": "支付失败"}), 500

    except Exception as e:
        logging.error(f"提交收费失败: {e}")
        return jsonify({"error": "提交失败"}), 500


@app.route("/uploads/<path:filename>", methods=["GET"])
def serve_upload(filename):
    uploads_dir = os.path.join(repo_root, "server", "uploads")
    # use flask.send_from_directory to correctly serve static uploads
    return send_from_directory(uploads_dir, filename)


# ==== cases persistence endpoints ====
@app.route("/users/<username>/cases", methods=["GET"])
def api_get_user_cases(username):
    try:
        # simple auth: allow if token user matches path or token empty (dev)
        token_user = get_username_from_header()
        if token_user and token_user != username:
            return jsonify({"error": "未授权"}), 403
        cases = get_cases_for_user(username)
        return jsonify({"cases": cases})
    except Exception as e:
        logging.error(f"获取用户会话失败: {e}", exc_info=True)
        return jsonify({"error": "内部错误"}), 500


@app.route("/cases", methods=["POST"])
def api_upsert_case():
    try:
        username = get_username_from_header()
        data = request.get_json() or {}
        if not username:
            return jsonify({"error": "未认证"}), 401
        # expect id (optional), title, messages (array)
        cid = upsert_case(data, username)
        return jsonify({"ok": True, "id": cid})
    except Exception as e:
        logging.error(f"保存会话失败: {e}", exc_info=True)
        return jsonify({"error": "内部错误"}), 500


@app.route("/cases/<case_id>", methods=["GET"])
def api_get_case(case_id):
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT id, owner, title, messages, prescriptions, billings, created_at, updated_at, status, assigned_doctor, parent_case_id FROM cases WHERE id = ?", (case_id,))
        r = cur.fetchone()
        conn.close()
        if not r:
            return jsonify({"error": "not found"}), 404
        try:
            msgs = json.loads(r["messages"]) if r["messages"] else []
        except Exception:
            msgs = []
        try:
            pres = json.loads(r["prescriptions"]) if r.get("prescriptions") else []
        except Exception:
            pres = []
        try:
            bills = json.loads(r["billings"]) if r.get("billings") else []
        except Exception:
            bills = []
        # Mask prescription details for patients until related billing is paid.
        requester = get_username_from_header()
        # determine requester role (doctor/admin) via token if available
        auth_header = request.headers.get("Authorization", "")
        requester_role = None
        if auth_header.startswith("Bearer "):
            try:
                token_data = serializer.loads(auth_header.split(" ", 1)[1].strip())
                requester_role = token_data.get("user_type") or token_data.get("role")
            except Exception:
                requester_role = None

        # Mask messages of type 'prescription'/'prescription_pending' for non-doctor/non-admin requesters.
        masked_msgs = []
        for m in msgs:
            if isinstance(m, dict) and m.get("type") in ("prescription", "prescription_pending"):
                if requester == r["assigned_doctor"] or requester_role == "admin":
                    masked_msgs.append(m)
                else:
                    # replace with placeholder
                    masked_msgs.append({
                        "id": m.get("id"),
                        "role": m.get("role"),
                        "type": "prescription_masked",
                        "content": "处方详情请付款后查看",
                        "ts": m.get("ts")
                    })
            else:
                masked_msgs.append(m)

        # For prescriptions collection, only include full prescription entries when billing paid or for doctor/admin
        masked_pres = []
        for p in pres:
            try:
                pres_id = p.get("id")
            except Exception:
                pres_id = None
            # find billing linked to this prescription
            linked = None
            for b in bills:
                if isinstance(b, dict) and b.get("prescription_id") == pres_id:
                    linked = b
                    break
            allow_full = False
            if requester == r["assigned_doctor"] or requester_role == "admin":
                allow_full = True
            else:
                if linked and linked.get("status") == "paid":
                    allow_full = True
            if allow_full:
                masked_pres.append(p)
            else:
                masked_pres.append({
                    "id": p.get("id"),
                    "content": "处方详情请付款后查看",
                    "images": [],
                    "medicines": [],
                    "created_at": p.get("created_at"),
                    "doctor": p.get("doctor")
                })

        return jsonify({
            "id": r["id"],
            "owner": r["owner"],
            "title": r["title"],
            "messages": msgs,
            "prescriptions": masked_pres,
            "billings": bills,
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
            "status": r["status"],
            "assigned_doctor": r["assigned_doctor"],
            "parent_case_id": r.get("parent_case_id") if isinstance(r, dict) else r[8]
        })
    except Exception as e:
        logging.error(f"获取会话失败: {e}", exc_info=True)
        return jsonify({"error": "内部错误"}), 500


@app.route("/cases/<case_id>", methods=["DELETE"])
def api_delete_case(case_id):
    """删除会话"""
    try:
        username = get_username_from_header()
        if not username:
            return jsonify({"error": "未认证"}), 401

        conn = get_db_conn()
        cur = conn.cursor()
        # 检查是否是所有者
        cur.execute("SELECT id FROM cases WHERE id = ? AND owner = ?", (case_id, username))
        if not cur.fetchone():
            conn.close()
            return jsonify({"error": "无权限删除"}), 403
        cur.execute("DELETE FROM cases WHERE id = ?", (case_id,))
        conn.commit()
        conn.close()
        return jsonify({"ok": True}), 200
    except Exception as e:
        logging.error(f"删除会话失败: {e}", exc_info=True)
        return jsonify({"error": "内部错误"}), 500


@app.route("/cases/<case_id>", methods=["PUT"])
def api_update_case(case_id):
    """编辑会话标题"""
    try:
        username = get_username_from_header()
        if not username:
            return jsonify({"error": "未认证"}), 401
        data = request.get_json() or {}
        title = data.get("title", "").strip()

        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT id FROM cases WHERE id = ? AND owner = ?", (case_id, username))
        if not cur.fetchone():
            conn.close()
            return jsonify({"error": "无权限修改"}), 403
        cur.execute("UPDATE cases SET title = ?, updated_at = ? WHERE id = ?", (title, int(time.time()), case_id))
        conn.commit()
        conn.close()
        return jsonify({"ok": True}), 200
    except Exception as e:
        logging.error(f"编辑会话失败: {e}", exc_info=True)
        return jsonify({"error": "内部错误"}), 500


@app.route('/ask', methods=['POST'])
def ask_question():
    try:
        # 可选的认证：解析 Authorization: Bearer <token>
        auth_header = request.headers.get("Authorization", "")
        username = None
        if auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1].strip()
            try:
                data = serializer.loads(token, max_age=60 * 60 * 24)  # 1 day
                username = data.get("username")
            except SignatureExpired:
                logging.warning("令牌已过期")
            except BadSignature:
                logging.warning("令牌无效")

        # 1. 获取用户问题
        data = request.get_json()
        if not data or 'question' not in data:
            logging.warning("收到无效请求: 缺少question字段")
            return jsonify({"error": "必须提供question参数"}), 400

        question = data['question']
        if username:
            logging.info(f"收到问题 (user={username}): {question[:50]}...")
        else:
            logging.info(f"收到问题: {question[:50]}...")  # 日志截断前50字符

        # 2. 检索相关文档
        retrieved_docs = retriever.invoke(question)
        logging.info(f"检索到{len(retrieved_docs)}条相关文档")

        # 3. 构建上下文
        context = "\n".join([
            f"【{doc.metadata['department']}】{doc.page_content}"
            for doc in retrieved_docs
        ])

        # 4. 调用模型生成回答
        result = chain.invoke({
            "answer": context,
            "question": question
        })

        # 5. 清理回答内容，去掉换行符并以空格连接
        cleaned_answer = " ".join(
            line.strip()
            for line in result.split("\n")
            if line.strip()
        )

        # 6. 优化回答格式，列出每一条建议
        optimized_answer = ""
        suggestions = cleaned_answer.split("。")  # 按句号分割建议
        for idx, suggestion in enumerate(suggestions, start=1):
            if suggestion.strip():
                optimized_answer += f"【建议 {idx}】: {suggestion.strip()}。"

        # 7. 返回优化后的回答
        return jsonify({"answer": optimized_answer.strip()})

    except Exception as e:
        logging.error(f"处理问题时出错: {str(e)}", exc_info=True)
        return jsonify({
            "error": "内部服务器错误",
            "details": str(e)
        }), 500


@app.route('/ask_stream', methods=['POST'])
def ask_stream():
    """
    使用指定模型流式回答问题，支持上下文关联
    source 参数: 'ds' = DeepSeek, 'qwen' = 千问, 'rag' = 本地RAG检索（默认）
    """
    import requests
    import os

    try:
        data = request.get_json()
        if not data or 'question' not in data:
            return jsonify({"error": "必须提供question参数"}), 400
        question = data['question']
        history = data.get('history', [])  # 获取历史消息
        source = data.get('source', 'rag')  # 获取模型来源
        logging.info(f"收到流式问题: {question[:50]}... (历史消息: {len(history)}条, source: {source})")

        if source == 'ds':
            # 使用 DeepSeek API
            return ask_stream_ds_impl(question, history)
        elif source == 'qwen':
            # 使用千问 API
            return ask_stream_qwen_impl(question, history)
        else:
            # 使用本地 RAG 检索
            return ask_stream_rag_impl(question, history)

    except Exception as e:
        logging.error(f"流式处理出错: {e}", exc_info=True)
        return jsonify({"error": "内部错误", "details": str(e)}), 500


def ask_stream_ds_impl(question, history):
    """
    DeepSeek API 流式回答
    """
    import requests
    import os

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    endpoint = os.environ.get("DEEPSEEK_ENDPOINT", "https://api.deepseek.com")
    model = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

    if not api_key:
        return jsonify({"error": "DeepSeek API 未配置"}), 500

    system_prompt = """你是一位专业、贴心的医疗健康助手。请用清晰的分段格式回答，内容要详细全面。

【格式要求】
1. 使用【】标注大标题，每个大标题独占一行
2. 内容要详细解释原因和机制
3. 适当使用数字编号（如一、二、三 或 1、2、3）
4. 段落之间空一行
5. 不要使用 **星号**、- 列表符号等 Markdown 格式
6. 紧急情况用 ⚠️ 标注

【回答示例格式】

【常见可能原因】

一、病毒感染
普通感冒多由鼻病毒、冠状病毒等引起，具有自限性，通常5-7天可自行痊愈。

二、细菌感染
少数感冒可能由细菌引起，如继发细菌性鼻窦炎、扁桃体炎等。

三、过敏因素
部分"感冒"实际是过敏性鼻炎，需与普通感冒鉴别。

【建议处理方式】

一、一般护理
保证充足睡眠，每天7-8小时；多喝温水，每日1500-2000ml；保持室内空气流通；补充维生素C。

二、对症处理
发热38.5℃以上可用退热药；咳嗽明显可用止咳药；鼻塞可用减充血剂。

三、密切观察
如出现高热（39℃以上）持续不退、咳嗽加重、胸闷气短、皮疹等症状，应及时就医。

【注意事项】
⚠️ 不要滥用抗生素，感冒多为病毒性
⚠️ 老人、儿童、孕妇等特殊人群需特别注意
⚠️ 症状超过10天无好转建议就医检查"""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        if msg.get('role') in ['user', 'assistant']:
            messages.append({
                "role": msg['role'],
                "content": msg['content']
            })
    messages.append({"role": "user", "content": question})

    payload = {
        "model": model,
        "messages": messages,
        "stream": False
    }

    resp = requests.post(f"{endpoint}/v1/chat/completions", headers=headers, json=payload, timeout=120)
    if not resp.ok:
        logging.error(f"DeepSeek API 调用失败: {resp.text}")
        return ask_stream_rag_impl(question, history)

    result = resp.json()
    answer = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    formatted_answer = format_analysis_result(answer)

    def generate():
        lines = formatted_answer.split('\n')
        for line in lines:
            if line:
                yield line + '\n'
            else:
                yield '\n'
            time.sleep(0.02)

    return app.response_class(generate(), mimetype='text/plain; charset=utf-8')


def ask_stream_qwen_impl(question, history):
    """
    千问 API 流式回答
    """
    import requests
    import os

    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        return jsonify({"error": "千问 API 未配置"}), 500

    chat_path = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    model = os.environ.get("QWEN_MODEL", "qwen-plus")

    system_prompt = """你是一位专业、贴心的医疗健康助手。请用清晰的分段格式回答，内容要详细全面。

【格式要求】
1. 使用【】标注大标题，每个大标题独占一行
2. 内容要详细解释原因和机制
3. 适当使用数字编号（如一、二、三 或 1、2、3）
4. 段落之间空一行
5. 不要使用 **星号**、- 列表符号等 Markdown 格式
6. 紧急情况用 ⚠️ 标注

【回答示例格式】

【常见可能原因】

一、病毒感染
普通感冒多由鼻病毒、冠状病毒等引起，具有自限性，通常5-7天可自行痊愈。

二、细菌感染
少数感冒可能由细菌引起，如继发细菌性鼻窦炎、扁桃体炎等。

三、过敏因素
部分"感冒"实际是过敏性鼻炎，需与普通感冒鉴别。

【建议处理方式】

一、一般护理
保证充足睡眠，每天7-8小时；多喝温水，每日1500-2000ml；保持室内空气流通；补充维生素C。

二、对症处理
发热38.5℃以上可用退热药；咳嗽明显可用止咳药；鼻塞可用减充血剂。

三、密切观察
如出现高热（39℃以上）持续不退、咳嗽加重、胸闷气短、皮疹等症状，应及时就医。

【注意事项】
⚠️ 不要滥用抗生素，感冒多为病毒性
⚠️ 老人、儿童、孕妇等特殊人群需特别注意
⚠️ 症状超过10天无好转建议就医检查"""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        if msg.get('role') in ['user', 'assistant']:
            messages.append({
                "role": msg['role'],
                "content": msg['content']
            })
    messages.append({"role": "user", "content": question})

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": 2000,
        "temperature": 0.7
    }

    resp = requests.post(chat_path, headers=headers, json=payload, timeout=120)
    if not resp.ok:
        logging.error(f"千问 API 调用失败: {resp.text}")
        return ask_stream_rag_impl(question, history)

    result = resp.json()
    answer = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    formatted_answer = format_analysis_result(answer)

    def generate():
        lines = formatted_answer.split('\n')
        for line in lines:
            if line:
                yield line + '\n'
            else:
                yield '\n'
            time.sleep(0.02)

    return app.response_class(generate(), mimetype='text/plain; charset=utf-8')


def ask_stream_rag_impl(question, history):
    """
    本地 RAG 检索流式回答
    """
    try:
        logging.info(f"使用 RAG 本地检索回答: {question[:50]}...")

        retrieved_docs = retriever.invoke(question)
        context = "\n".join([
            f"【{doc.metadata.get('department','')}】{doc.page_content}"
            for doc in retrieved_docs
        ])

        result = chain.invoke({
            "answer": context,
            "question": question
        })

        cleaned_answer = "\n".join(
            line.strip()
            for line in result.split("\n")
            if line.strip()
        )
        suggestions = cleaned_answer.split("\n")
        optimized_answer = ""
        for idx, suggestion in enumerate(suggestions, start=1):
            if suggestion.strip():
                optimized_answer += f"【建议 {idx}】: {suggestion.strip()}。"

        def generate():
            text = optimized_answer.strip()
            text = format_analysis_result(text)
            lines = text.split('\n')
            for line in lines:
                if line:
                    yield line + '\n'
                else:
                    yield '\n'
                time.sleep(0.02)
        return app.response_class(generate(), mimetype='text/plain; charset=utf-8')

    except Exception as e:
        logging.error(f"RAG 本地模型处理出错: {e}", exc_info=True)
        return jsonify({"error": "内部错误", "details": str(e)}), 500


def ask_stream_local_impl():
    """
    兼容旧版本的本地模型调用
    """
    try:
        data = request.get_json()
        question = data['question']
        return ask_stream_rag_impl(question, [])
    except Exception as e:
        logging.error(f"本地模型处理出错: {e}", exc_info=True)
        return jsonify({"error": "内部错误", "details": str(e)}), 500


@app.route('/ask_deepseek_direct', methods=['POST'])
def ask_deepseek_direct():
    """
    直接調用 DeepSeek API，提供高質量、像 ChatGPT 一樣的醫療回答
    繞過 RAG 和 Llama 模型
    """
    import requests
    import os
    
    try:
        data = request.get_json()
        if not data or 'question' not in data:
            return jsonify({"error": "缺少問題參數"}), 400
        
        question = data.get('question', '').strip()
        if not question:
            return jsonify({"error": "問題不能為空"}), 400
        
        # 獲取 DeepSeek API 配置
        api_key = os.environ.get("DEEPSEEK_API_KEY")
        endpoint = os.environ.get("DEEPSEEK_ENDPOINT", "https://api.deepseek.com")
        model = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
        
        if not api_key:
            return jsonify({"error": "DeepSeek API 未配置，請設置 DEEPSEEK_API_KEY 環境變量"}), 500
        
        # 構建醫療助手系統提示詞（分段清晰的分點格式）
        system_prompt = """你是一位專業、貼心的醫療健康助手。請用清晰的分段格式回答，每個大標題和內容都要分行顯示。

【強制格式規則 - 必須嚴格遵守】
1. 使用中文數字（一、二、三...）或數字（1、2、3...）編號每個主要類別
2. 每個大類標題必須獨占一行，使用【】標註，如：【常見可能原因】
3. 每個細項必須分行顯示，用適當縮進或符號區分
4. 緊急信號用 ⚠️ 符號標註
5. 段落之間要空一行
6. 不要使用任何 Markdown 格式（**星號**、#標題、-列表符號）

【回答示例格式】

【常見可能原因】

一、頸源性頭痛
頸部肌肉、關節或神經的問題（如肌肉拉傷、頸椎小關節紊亂）是常見原因。頭部活動會牽拉受影響的區域，導致疼痛。

二、緊張性頭痛
頭頸部肌肉持續緊繃，搖晃頭部可能加劇不適。

三、偏頭痛
部分偏頭痛患者在發作期對頭部活動特別敏感，輕微晃動即可加劇搏動性疼痛。

【你可以嘗試的步驟】

第一步：暫時休息
避免劇烈或快速的頭部運動，保持頭頸部在舒適的姿勢。

第二步：溫和處理
可以嘗試對疼痛的頸部或頭部後方進行溫和的熱敷，每次 15 到 20 分鐘，有助於放鬆肌肉。

第三步：觀察記錄
注意疼痛的具體位置（如後腦勺、太陽穴、前額）、疼痛性質（如脹痛、刺痛、搏動痛）以及是否伴有其他症狀。

【需要立即就醫的信號】

⚠️ 情況一：疼痛特徵異常
疼痛極其劇烈，突然發生（像被重擊或雷劈一樣）

⚠️ 情況二：全身症狀
伴隨高燒、畏光、頸部異常僵硬或皮疹

【建議】

如果疼痛不劇烈且沒有上述危險信號，但持續數天未見好轉，或反覆發作，建議你諮詢醫生（如家庭醫學科、神經內科或骨科），以進行詳細評估，明確病因並獲得針對性治療。"""
        
        # 調用 DeepSeek API
        chat_url = f"{endpoint}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": question}
            ],
            "max_tokens": 2000,
            "temperature": 0.7
        }
        
        logging.info(f"直接調用 DeepSeek API: {question[:50]}...")
        
        resp = requests.post(chat_url, json=payload, headers=headers, timeout=30)
        
        if not resp.ok:
            logging.error(f"DeepSeek API 錯誤: {resp.status_code} {resp.text}")
            return jsonify({"error": f"API 調用失敗: {resp.status_code}"}), 500
        
        result = resp.json()
        answer = result.get("choices", [{}])[0].get("message", {}).get("content", "")
        
        if not answer:
            return jsonify({"error": "無法獲取回答"}), 500
        
        logging.info(f"DeepSeek 回答完成: {len(answer)} 字")
        return jsonify({"answer": answer.strip()})
        
    except requests.exceptions.Timeout:
        logging.error("DeepSeek API 超時")
        return jsonify({"error": "請求超時，請稍後重試"}), 504
    except Exception as e:
        logging.error(f"DeepSeek 回答出錯: {e}", exc_info=True)
        return jsonify({"error": f"內部錯誤: {str(e)}"}), 500


@app.route('/ask_deepseek_stream', methods=['POST'])
def ask_deepseek_stream():
    """
    流式調用 DeepSeek API，提供高質量回答
    """
    import requests
    import os
    
    try:
        data = request.get_json()
        if not data or 'question' not in data:
            return jsonify({"error": "缺少問題參數"}), 400
        
        question = data.get('question', '').strip()
        if not question:
            return jsonify({"error": "問題不能為空"}), 400
        
        api_key = os.environ.get("DEEPSEEK_API_KEY")
        endpoint = os.environ.get("DEEPSEEK_ENDPOINT", "https://api.deepseek.com")
        model = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
        
        if not api_key:
            return jsonify({"error": "DeepSeek API 未配置"}), 500

        # 構建醫療助手系統提示詞（分段清晰的分點格式）
        system_prompt = """你是一位專業、貼心的醫療健康助手。請用清晰的分段格式回答，每個大標題和內容都要分行顯示。

【強制格式規則 - 必須嚴格遵守】
1. 使用中文數字（一、二、三...）或數字（1、2、3...）編號每個主要類別
2. 每個大類標題必須獨占一行，使用【】標註，如：【常見可能原因】
3. 每個細項必須分行顯示，用適當縮進或符號區分
4. 緊急信號用 ⚠️ 符號標註
5. 段落之間要空一行
6. 不要使用任何 Markdown 格式（**星號**、#標題、-列表符號）

【回答示例格式】

【常見可能原因】

一、頸源性頭痛
頸部肌肉、關節或神經的問題（如肌肉拉傷、頸椎小關節紊亂）是常見原因。頭部活動會牽拉受影響的區域，導致疼痛。

二、緊張性頭痛
頭頸部肌肉持續緊繃，搖晃頭部可能加劇不適。

三、偏頭痛
部分偏頭痛患者在發作期對頭部活動特別敏感，輕微晃動即可加劇搏動性疼痛。

【你可以嘗試的步驟】

第一步：暫時休息
避免劇烈或快速的頭部運動，保持頭頸部在舒適的姿勢。

第二步：溫和處理
可以嘗試對疼痛的頸部或頭部後方進行溫和的熱敷，每次 15 到 20 分鐘，有助於放鬆肌肉。

第三步：觀察記錄
注意疼痛的具體位置（如後腦勺、太陽穴、前額）、疼痛性質（如脹痛、刺痛、搏動痛）以及是否伴有其他症狀。

【需要立即就醫的信號】

⚠️ 情況一：疼痛特徵異常
疼痛極其劇烈，突然發生（像被重擊或雷劈一樣）

⚠️ 情況二：全身症狀
伴隨高燒、畏光、頸部異常僵硬或皮疹

【建議】

如果疼痛不劇烈且沒有上述危險信號，但持續數天未見好轉，或反覆發作，建議你諮詢醫生（如家庭醫學科、神經內科或骨科），以進行詳細評估，明確病因並獲得針對性治療。"""
        
        chat_url = f"{endpoint}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": question}
            ],
            "max_tokens": 2000,
            "temperature": 0.7,
            "stream": True
        }
        
        logging.info(f"流式調用 DeepSeek: {question[:50]}...")
        
        resp = requests.post(chat_url, json=payload, headers=headers, timeout=30, stream=True)
        
        if not resp.ok:
            return jsonify({"error": f"API 錯誤: {resp.status_code}"}), 500
        
        def generate():
            for line in resp.iter_lines():
                if line:
                    line = line.decode('utf-8')
                    if line.startswith('data: '):
                        data = line[6:]
                        if data != '[DONE]':
                            try:
                                import json
                                chunk = json.loads(data)
                                content = chunk.get('choices', [{}])[0].get('delta', {}).get('content', '')
                                if content:
                                    yield content
                            except:
                                pass
        
        return app.response_class(generate(), mimetype='text/plain; charset=utf-8')
        
    except Exception as e:
        logging.error(f"流式 DeepSeek 錯誤: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/doctor-ask', methods=['POST'])
def doctor_ask():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401
    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401

        data = request.get_json() or {}
        question = data.get('question', '').strip()
        if not question:
            return jsonify({"error": "Missing question"}), 400

        # reuse RAG chain
        retrieved_docs = retriever.invoke(question)
        context = "\n".join([f"【{doc.metadata.get('department','')}】{doc.page_content}" for doc in retrieved_docs])
        result = chain.invoke({
            "answer": context,
            "question": question
        })
        cleaned = " ".join(line.strip() for line in result.split("\n") if line.strip())

        # persist as a case for doctor
        try:
            now = int(time.time())
            case_obj = {"title": f"医生对话 - {question[:30]}", "messages": [{"role":"user","text":question},{"role":"assistant","text":cleaned}]}
            cid = upsert_case(case_obj, username)
            # assign to doctor
            conn = get_db_conn()
            cur = conn.cursor()
            cur.execute("UPDATE cases SET assigned_doctor = ?, status = ?, updated_at = ? WHERE id = ?", (username, 'active', now, cid))
            conn.commit()
            conn.close()
        except Exception as e:
            logging.error(f"保存医生对话失败: {e}")

        return jsonify({"answer": cleaned, "case_id": cid}), 200
    except Exception as e:
        logging.error(f"doctor_ask failed: {e}", exc_info=True)
        return jsonify({"error": "内部错误", "details": str(e)}), 500


@app.route('/doctor-ask_stream', methods=['POST'])
def doctor_ask_stream():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401
    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401

        data = request.get_json() or {}
        question = data.get('question', '').strip()
        if not question:
            return jsonify({"error": "Missing question"}), 400

        source = data.get('source', 'ds')  # ds=DeepSeek, qwen=千问, rag=本地RAG

        case_id = data.get('caseId')
        conversation_history = []

        if case_id:
            try:
                conn = get_db_conn()
                cur = conn.cursor()
                cur.execute("SELECT messages FROM cases WHERE id = ?", (case_id,))
                row = cur.fetchone()
                if row and row[0]:
                    conversation_history = json.loads(row[0])
                conn.close()
            except Exception as e:
                logging.warning(f"加载对话历史失败: {e}")

        # 根据 source 选择模型
        import requests
        import re

        if source == 'ds':
            # DeepSeek API
            key = os.environ.get("DEEPSEEK_API_KEY")
            endpoint = os.environ.get("DEEPSEEK_ENDPOINT") or "https://api.deepseek.com"

            if conversation_history:
                messages = [{"role": "system", "content": "你是一位专业、耐心的医疗健康助手。请根据对话历史回答用户的问题。"}]
                for msg in conversation_history:
                    role = "user" if msg.get('role') == 'user' else "assistant"
                    messages.append({"role": role, "content": msg.get('text', '')})
                messages.append({"role": "user", "content": question})
            else:
                messages = [
                    {"role": "system", "content": "你是一位专业、耐心的医疗健康助手。请简洁、准确地回答用户的健康问题。"},
                    {"role": "user", "content": question}
                ]

            payload = {
                "model": os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
                "messages": messages,
                "stream": False
            }

            headers = {
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json"
            }

            resp = requests.post(f"{endpoint}/chat/completions", json=payload, headers=headers, timeout=30)
            resp.raise_for_status()
            resp_data = resp.json()

            if resp_data.get("choices"):
                raw = resp_data["choices"][0]["message"]["content"]
                cleaned = raw
                cleaned = re.sub(r'\*\*(.+?)\*\*', r'\1', cleaned)
                cleaned = re.sub(r'^[\-\*]\s+', '', cleaned, flags=re.MULTILINE)
                cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
            else:
                cleaned = "抱歉，无法获取回答。"
        elif source == 'qwen':
            # 千问 API
            key = os.environ.get("DASHSCOPE_API_KEY")
            chat_path = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
            model = os.environ.get("QWEN_MODEL", "qwen-plus")

            if conversation_history:
                messages = [{"role": "system", "content": "你是一位专业、耐心的医疗健康助手。请根据对话历史回答用户的问题。"}]
                for msg in conversation_history:
                    role = "user" if msg.get('role') == 'user' else "assistant"
                    messages.append({"role": role, "content": msg.get('text', '')})
                messages.append({"role": "user", "content": question})
            else:
                messages = [
                    {"role": "system", "content": "你是一位专业、耐心的医疗健康助手。请简洁、准确地回答用户的健康问题。"},
                    {"role": "user", "content": question}
                ]

            payload = {
                "model": model,
                "messages": messages,
                "max_tokens": 2000,
                "temperature": 0.7
            }

            headers = {
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json"
            }

            resp = requests.post(chat_path, json=payload, headers=headers, timeout=30)
            resp.raise_for_status()
            resp_data = resp.json()

            if resp_data.get("choices"):
                raw = resp_data["choices"][0]["message"]["content"]
                cleaned = raw
                cleaned = re.sub(r'\*\*(.+?)\*\*', r'\1', cleaned)
                cleaned = re.sub(r'^[\-\*]\s+', '', cleaned, flags=re.MULTILINE)
                cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
            else:
                cleaned = "抱歉，无法获取回答。"
        else:
            # RAG 本地检索
            retrieved_docs = retriever.invoke(question)
            context = "\n".join([
                f"【{doc.metadata.get('department', '')}】{doc.page_content}"
                for doc in retrieved_docs
            ])
            result = chain.invoke({
                "answer": context,
                "question": question
            })
            cleaned = " ".join(line.strip() for line in result.split("\n") if line.strip())

        def generate():
            lines = cleaned.split('\n')
            for line in lines:
                if line.strip():
                    yield line.strip() + '\n'
                else:
                    yield '\n'
                time.sleep(0.02)
            # 保存对话
            try:
                now = int(time.time())
                if case_id and conversation_history:
                    conn = get_db_conn()
                    cur = conn.cursor()
                    cur.execute("SELECT messages FROM cases WHERE id = ?", (case_id,))
                    row = cur.fetchone()
                    if row:
                        msgs = json.loads(row[0] or "[]")
                        msgs.append({"role": "user", "text": question})
                        msgs.append({"role": "assistant", "text": cleaned})
                        cur.execute("UPDATE cases SET messages = ?, updated_at = ?, source = 'ai' WHERE id = ?",
                                  (json.dumps(msgs, ensure_ascii=False), now, case_id))
                        conn.commit()
                        conn.close()
                    else:
                        conn.close()
                        case_obj = {"title": f"医生对话 - {question[:30]}", "messages": [{"role":"user","text":question},{"role":"assistant","text":cleaned}]}
                        upsert_case(case_obj, username)
                else:
                    case_obj = {"title": f"医生对话 - {question[:30]}", "messages": [{"role":"user","text":question},{"role":"assistant","text":cleaned}]}
                    cid = upsert_case(case_obj, username)
                    conn = get_db_conn()
                    cur = conn.cursor()
                    cur.execute("UPDATE cases SET assigned_doctor = ?, status = ?, updated_at = ?, source = 'ai' WHERE id = ?", (username, 'active', now, cid))
                    conn.commit()
                    conn.close()
            except Exception as e:
                logging.error(f"保存医生对话失败: {e}")

        return app.response_class(generate(), mimetype='text/plain; charset=utf-8')
    except Exception as e:
        logging.error(f"doctor_ask_stream failed: {e}", exc_info=True)
        return jsonify({"error": "内部错误", "details": str(e)}), 500


@app.route('/doctors', methods=['GET'])
def list_doctors():
    try:
        from main import DB_FILE
        _dbg(f"list_doctors DB_FILE={DB_FILE}")
        conn = get_db_conn()
        cur = conn.cursor()

        department_id = request.args.get('department_id', type=int)
        rows = []

        if department_id:
            cur.execute("""
                SELECT ud.username, ud.display_name, ud.avatar_url, ud.clinic,
                       ud.specialties, ud.bio, ud.phone, ud.license_number, ud.department_id,
                       COALESCE(d.name, ''), COALESCE(ud.accept_consultations, 1), COALESCE(ud.title, '')
                FROM users_doctor ud
                LEFT JOIN departments d ON d.id = ud.department_id
                WHERE ud.is_deleted = 0 AND ud.verified = 1
                  AND ud.department_id = ?
            """, (department_id,))
            rows = cur.fetchall()

            if len(rows) == 0:
                cur.execute("SELECT name FROM departments WHERE id = ?", (department_id,))
                dept_row = cur.fetchone()
                if dept_row:
                    dept_name = dept_row[0]
                    cur.execute("""
                        SELECT ud.username, ud.display_name, ud.avatar_url, ud.clinic,
                               ud.specialties, ud.bio, ud.phone, ud.license_number, ud.department_id,
                               COALESCE(d.name, ''), COALESCE(ud.accept_consultations, 1), COALESCE(ud.title, '')
                        FROM users_doctor ud
                        LEFT JOIN departments d ON d.id = ud.department_id
                        WHERE ud.is_deleted = 0 AND ud.verified = 1
                          AND (ud.specialties LIKE ? OR ud.specialties LIKE ?)
                    """, (f'%{dept_name}%', f'%{dept_name[0:2]}%'))
                    rows = cur.fetchall()
        else:
            # DEBUG: run both queries and compare
            cur.execute("SELECT username, display_name FROM users_doctor WHERE is_deleted=0 AND verified=1")
            raw_rows = cur.fetchall()
            _dbg(f"Raw query: {len(raw_rows)} rows")
            for rw in raw_rows:
                _dbg(f"  raw: {rw[0]} | {rw[1]}")

            cur.execute("""
                SELECT ud.username, ud.display_name, ud.avatar_url, ud.clinic,
                       ud.specialties, ud.bio, ud.phone, ud.license_number, ud.department_id,
                       COALESCE(d.name, ''), COALESCE(ud.accept_consultations, 1), COALESCE(ud.title, '')
                FROM users_doctor ud
                LEFT JOIN departments d ON d.id = ud.department_id
                WHERE ud.is_deleted = 0 AND ud.verified = 1
            """)
            rows = cur.fetchall()
            _dbg(f"JOIN query: {len(rows)} rows")

        conn.close()
        _dbg(f"list_doctors: department_id={department_id}, rows={len(rows)}")
        result = []
        for r in rows:
            _dbg(f"  row: {r[0]}, {r[1]}, {r[4]}")
            result.append({
                "username": r[0],
                "display_name": r[1],
                "avatar_url": r[2],
                "clinic": r[3],
                "specialties": r[4],
                "bio": r[5],
                "phone": r[6],
                "license_number": r[7],
                "department_id": r[8],
                "department_name": r[9],
                "accept_consultations": r[10],
                "title": r[11],
                "verified": 1
            })

        return jsonify({"doctors": result}), 200
    except Exception as e:
        logging.error(f"list_doctors failed: {e}", exc_info=True)
        return jsonify({"error": "获取医生列表失败"}), 500


@app.route('/doctors/<username>', methods=['GET'])
def get_doctor_by_username(username):
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT username, display_name, avatar_url, clinic, specialties, bio, phone, license_number FROM users_doctor WHERE username = ? AND is_deleted = 0", (username,))
        row = cur.fetchone()
        conn.close()

        if not row:
            return jsonify({"error": "医生不存在"}), 404

        return jsonify({
            "username": row[0],
            "display_name": row[1],
            "avatar_url": row[2],
            "clinic": row[3],
            "specialties": row[4],
            "bio": row[5],
            "phone": row[6],
            "license_number": row[7]
        }), 200
    except Exception as e:
        logging.error(f"获取医生信息失败: {e}", exc_info=True)
        return jsonify({"error": "获取医生信息失败"}), 500


@app.route('/submit_request', methods=['POST'])
def submit_request():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    # allow anonymous submissions as well (patient may not be logged in)
    username = None
    if token:
        try:
            token_data = serializer.loads(token)
            username = token_data.get('username')
        except Exception:
            username = None

    try:
        data = request.get_json() or {}
        title = data.get('title') or '患者求助'
        messages = data.get('messages', [])
        extra_info = data.get('extra_info', '')
        requested_doctor = data.get('requested_doctor')
        attachments = data.get('attachments', [])

        now = int(time.time())
        # create case object
        case_obj = {
            "id": f"case-{now}-{int(time.time()*1000)%1000}",
            "title": title,
            "messages": messages,
            "created_at": now,
            "updated_at": now
        }
        owner = username or data.get('owner') or 'anonymous'
        cid = upsert_case(case_obj, owner)

        # set requested doctor if provided (assign later when doctor accepts)
        # 确保 assigned_doctor 不能是患者自己
        if requested_doctor and requested_doctor != owner:
            doctor_to_assign = requested_doctor
        else:
            doctor_to_assign = None

        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("UPDATE cases SET assigned_doctor = ?, status = ?, updated_at = ?, source = 'manual' WHERE id = ?", (doctor_to_assign, 'pending', now, cid))
        conn.commit()
        conn.close()

        return jsonify({"message":"提交成功","case_id": cid}), 200
    except Exception as e:
        logging.error(f"submit_request failed: {e}", exc_info=True)
        return jsonify({"error":"提交失败"}), 500


@app.route("/doctor-stats", methods=["GET"])
def doctor_stats():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401
    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401
        # time range handling: preset or explicit start/end (unix seconds)
        preset = (request.args.get('preset') or '').lower()
        start_arg = request.args.get('start')
        end_arg = request.args.get('end')
        now = int(time.time())
        start_ts = None
        end_ts = None
        if start_arg:
            try:
                start_ts = int(start_arg)
            except Exception:
                start_ts = None
        if end_arg:
            try:
                end_ts = int(end_arg)
            except Exception:
                end_ts = None
        if preset and not (start_ts or end_ts):
            d = time.localtime(now)
            if preset == 'today':
                start_ts = int(time.mktime((d.tm_year, d.tm_mon, d.tm_mday, 0, 0, 0, 0, 0, -1)))
            elif preset == 'week':
                # start of week (Sunday)
                weekday = d.tm_wday  # 0=Mon, use offset
                # compute days since Sunday
                days_since_sunday = (d.tm_wday + 1) % 7
                start_day = now - days_since_sunday * 86400
                sd = time.localtime(start_day)
                start_ts = int(time.mktime((sd.tm_year, sd.tm_mon, sd.tm_mday, 0, 0, 0, 0, 0, -1)))
            elif preset == 'month':
                start_ts = int(time.mktime((d.tm_year, d.tm_mon, 1, 0, 0, 0, 0, 0, -1)))
        # default end is now if start provided and end not provided
        if start_ts and not end_ts:
            end_ts = now

        conn = get_db_conn()
        cur = conn.cursor()
        # build query with optional time range
        q = "SELECT id, created_at, completed_at, status, billings, prescriptions, diagnosis FROM cases WHERE assigned_doctor = ?"
        params = [username]
        if start_ts is not None:
            q += " AND created_at >= ?"
            params.append(start_ts)
        if end_ts is not None:
            q += " AND created_at <= ?"
            params.append(end_ts)
        cur.execute(q, tuple(params))
        rows = cur.fetchall()
        total_cases = len(rows)
        active = 0
        pending = 0
        completed = 0
        total_income = 0.0
        total_outstanding = 0.0
        prescriptions_count = 0
        completion_durations = []
        case_ids = []
        diagnoses = {}
        for r in rows:
            cid = r["id"] if isinstance(r, dict) else r[0]
            case_ids.append(cid)
            status = r["status"] if isinstance(r, dict) else r[3]
            if status == 'active':
                active += 1
            elif status == 'pending':
                pending += 1
            elif status == 'completed':
                completed += 1
            # billings
            bills_json = r["billings"] if isinstance(r, dict) else r[4]
            try:
                bills = json.loads(bills_json) if bills_json else []
            except Exception:
                bills = []
            for b in bills:
                try:
                    amt = float(b.get('amount', 0))
                except Exception:
                    amt = 0.0
                if b.get('status') == 'paid':
                    total_income += amt
                else:
                    # treat missing status as outstanding
                    total_outstanding += amt
            # prescriptions
            pres_json = r["prescriptions"] if isinstance(r, dict) else r[5]
            try:
                pres = json.loads(pres_json) if pres_json else []
            except Exception:
                pres = []
            for p in pres:
                if p.get('doctor') == username:
                    prescriptions_count += 1
            # completion durations
            created_at = r["created_at"] if isinstance(r, dict) else r[1]
            completed_at = r["completed_at"] if isinstance(r, dict) else r[2]
            try:
                if completed_at and created_at:
                    dur = int(completed_at) - int(created_at)
                    if dur > 0:
                        completion_durations.append(dur)
            except Exception:
                pass
            # diagnoses
            diag = r["diagnosis"] if isinstance(r, dict) else r[6]
            if diag:
                diagnoses[diag] = diagnoses.get(diag, 0) + 1

        avg_completion_seconds = int(sum(completion_durations)/len(completion_durations)) if completion_durations else None
        avg_completion_days = round(avg_completion_seconds/86400, 2) if avg_completion_seconds else None

        # top tags
        top_tags = []
        try:
            if case_ids:
                qmarks = ",".join("?" for _ in case_ids)
                cur.execute(f"SELECT tag, COUNT(*) as cnt FROM case_tags WHERE case_id IN ({qmarks}) GROUP BY tag ORDER BY cnt DESC LIMIT 10", tuple(case_ids))
                tr = cur.fetchall()
                for t in tr:
                    top_tags.append({"tag": t[0], "count": t[1]})
        except Exception:
            pass

        # top diagnoses
        top_diagnoses = sorted([{"diagnosis": k, "count": v} for k, v in diagnoses.items()], key=lambda x: x["count"], reverse=True)[:10]

        conn.close()
        # build timeseries (daily counts) for the selected period
        timeseries = []
        try:
            if start_ts is None and end_ts is None:
                end_ts_local = now
                start_ts_local = now - 29*86400
            else:
                start_ts_local = start_ts or (end_ts - 29*86400 if end_ts else (now - 29*86400))
                end_ts_local = end_ts or (start_ts_local + 29*86400)
            # query grouped by date — use a new connection to avoid using closed cursor
            conn2 = get_db_conn()
            cur2 = conn2.cursor()
            cur2.execute("SELECT date(created_at, 'unixepoch') as d, COUNT(*) as cnt FROM cases WHERE assigned_doctor = ? AND created_at >= ? AND created_at <= ? GROUP BY d ORDER BY d", (username, int(start_ts_local), int(end_ts_local)))
            rows_ts = cur2.fetchall()
            conn2.close()
            counts_map = {r[0]: r[1] for r in rows_ts}
            # iterate days inclusive
            curr = time.localtime(int(start_ts_local))
            start_day = time.mktime((curr.tm_year, curr.tm_mon, curr.tm_mday, 0, 0, 0, 0, 0, -1))
            num_days = int((int(end_ts_local) - int(start_day)) / 86400) + 1
            for i in range(num_days):
                d_ts = int(start_day) + i*86400
                ds = time.strftime("%Y-%m-%d", time.localtime(d_ts))
                timeseries.append({"date": ds, "count": int(counts_map.get(ds, 0))})
        except Exception:
            timeseries = []

        return jsonify({
            "total_cases": total_cases,
            "active": active,
            "pending": pending,
            "completed": completed,
            "total_income": total_income,
            "total_outstanding": total_outstanding,
            "prescriptions_count": prescriptions_count,
            "avg_completion_days": avg_completion_days,
            "top_tags": top_tags,
            "top_diagnoses": top_diagnoses
            , "timeseries": timeseries
        }), 200
    except Exception as e:
        logging.error(f"doctor_stats failed: {e}", exc_info=True)
        return jsonify({"error": "获取统计失败"}), 500


# ==================== 预约挂号相关 API ====================

@app.route("/departments", methods=["GET"])
def get_departments():
    """获取科室列表"""
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT id, name, description, icon, sort_order FROM departments ORDER BY sort_order")
        rows = cur.fetchall()
        conn.close()
        departments = [{"id": r[0], "name": r[1], "description": r[2], "icon": r[3], "sort_order": r[4]} for r in rows]
        return jsonify({"departments": departments}), 200
    except Exception as e:
        logging.error(f"获取科室列表失败: {e}", exc_info=True)
        return jsonify({"error": "获取科室列表失败"}), 500



        return jsonify({"id": aid}), 200
    except Exception as e:
        logging.error(f"create_appointment failed: {e}", exc_info=True)
        return jsonify({"error":"创建失败"}), 500


@app.route("/appointments/<int:aid>", methods=["PUT"])
def update_appointment(aid):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401
    try:
        token_data = serializer.loads(token)
        username = token_data.get('username')
        if not username:
            return jsonify({"error": "Invalid token"}), 401
        data = request.get_json() or {}
        start = data.get('start')
        end = data.get('end')
        if not start or not end:
            return jsonify({"error": "缺少 start/end"}), 400
        conn = get_db_conn()
        cur = conn.cursor()
        # ensure appointment belongs to this doctor
        cur.execute("SELECT doctor_username FROM appointments WHERE id = ?", (aid,))
        r = cur.fetchone()
        if not r:
            conn.close()
            return jsonify({"error": "未找到"}), 404
        if r[0] != username:
            conn.close()
            return jsonify({"error": "无权修改"}), 403
        cur.execute("UPDATE appointments SET start_ts = ?, end_ts = ? WHERE id = ?", (int(start), int(end), aid))
        conn.commit()
        conn.close()
        return jsonify({"message":"updated"}), 200
    except Exception as e:
        logging.error(f"update_appointment failed: {e}", exc_info=True)
        return jsonify({"error":"更新失败"}), 500


@app.route("/cases/<case_id>/ban", methods=["POST"])
def ban_case_chat(case_id):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401
    try:
        token_data = serializer.loads(token)
        actor = token_data.get('username')
        role = token_data.get('role') or token_data.get('user_type')
        if not actor:
            return jsonify({"error": "Invalid token"}), 401
        data = request.get_json() or {}
        reason = data.get('reason', '')
        conn = get_db_conn()
        cur = conn.cursor()
        # check case exists and permission: admin or assigned doctor
        cur.execute("SELECT assigned_doctor FROM cases WHERE id = ?", (case_id,))
        r = cur.fetchone()
        if not r:
            conn.close()
            return jsonify({"error": "病例不存在"}), 404
        assigned = r[0] if isinstance(r, dict) else r[0]
        if role != 'admin' and actor != assigned:
            conn.close()
            return jsonify({"error": "无权封禁此会话"}), 403
        now = int(time.time())
        cur.execute("UPDATE cases SET chat_banned = 1, updated_at = ? WHERE id = ?", (now, case_id))
        try:
            cur.execute("INSERT INTO chat_bans_audit (case_id, actor, action, reason, created_at) VALUES (?, ?, ?, ?, ?)", (case_id, actor, 'ban', reason, now))
        except Exception:
            pass
        conn.commit()
        conn.close()
        return jsonify({"message": "已封禁聊天"}), 200
    except Exception as e:
        logging.error(f"ban_case_chat failed: {e}", exc_info=True)
        return jsonify({"error": "封禁失败"}), 500


@app.route("/cases/<case_id>/ban", methods=["DELETE"])
def unban_case_chat(case_id):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({"error": "No token"}), 401
    try:
        token_data = serializer.loads(token)
        actor = token_data.get('username')
        role = token_data.get('role') or token_data.get('user_type')
        if not actor:
            return jsonify({"error": "Invalid token"}), 401
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT assigned_doctor FROM cases WHERE id = ?", (case_id,))
        r = cur.fetchone()
        if not r:
            conn.close()
            return jsonify({"error": "病例不存在"}), 404
        assigned = r[0] if isinstance(r, dict) else r[0]
        if role != 'admin' and actor != assigned:
            conn.close()
            return jsonify({"error": "无权解除封禁"}), 403
        now = int(time.time())
        cur.execute("UPDATE cases SET chat_banned = 0, updated_at = ? WHERE id = ?", (now, case_id))
        try:
            cur.execute("INSERT INTO chat_bans_audit (case_id, actor, action, reason, created_at) VALUES (?, ?, ?, ?, ?)", (case_id, actor, 'unban', '', now))
        except Exception:
            pass
        conn.commit()
        conn.close()
        return jsonify({"message": "已解除封禁"}), 200
    except Exception as e:
        logging.error(f"unban_case_chat failed: {e}", exc_info=True)
        return jsonify({"error": "解除失败"}), 500


@app.route("/analyze_image", methods=["POST"])
def analyze_image():
    """
    使用 DeepSeek Vision 分析医学图片
    支持检查报告、症状图片、医学影像等
    """
    import requests
    import base64
    import os

    try:
        data = request.get_json()
        if not data or 'image_url' not in data:
            return jsonify({"error": "缺少图片URL参数"}), 400

        image_url = data.get('image_url', '').strip()
        if not image_url:
            return jsonify({"error": "图片URL不能为空"}), 400

        # 获取 DeepSeek API 配置
        api_key = (os.environ.get("DEEPSEEK_API_KEY") or
                   os.environ.get("VITE_DEEPSEEK_API_KEY") or
                   "")
        endpoint = os.environ.get("DEEPSEEK_ENDPOINT", "https://api.deepseek.com")
        model = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

        if not api_key:
            # 如果没有 API Key，返回提示信息
            return jsonify({
                "analysis": "图片分析功能需要配置 DeepSeek API Key。请联系管理员配置 VITE_DEEPSEEK_API_KEY 环境变量。"
            }), 200

        # 如果是本地URL，尝试读取图片并转为 base64
        image_content = None
        if image_url.startswith('http://127.0.0.1:8080'):
            try:
                # 下载图片
                img_resp = requests.get(image_url, timeout=10)
                if img_resp.status_code == 200:
                    # 使用 Pillow 压缩图片以减少 token 数量
                    from io import BytesIO
                    from PIL import Image

                    # 打开图片
                    img = Image.open(BytesIO(img_resp.content))

                    # 转换为 RGB（如果是 RGBA）
                    if img.mode in ('RGBA', 'P'):
                        img = img.convert('RGB')

                    # 压缩图片，最大尺寸 1024x1024，质量 70%
                    max_size = 1024
                    img.thumbnail((max_size, max_size), Image.LANCZOS)

                    # 保存到缓冲区
                    buffer = BytesIO()
                    img.save(buffer, format='JPEG', quality=70, optimize=True)
                    buffer.seek(0)

                    image_content = base64.b64encode(buffer.read()).decode('utf-8')
                    logging.info(f"图片压缩后大小: {len(image_content)} characters")
            except Exception as e:
                logging.error(f"下载/压缩图片失败: {e}")
                # 如果压缩失败，尝试直接使用原始图片
                try:
                    image_content = base64.b64encode(img_resp.content).decode('utf-8')
                except:
                    pass

        if not image_content:
            return jsonify({
                "analysis": "无法访问图片，请确保图片URL可访问或尝试重新上传。"
            }), 200

        # 构建 Vision API 请求
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        # 医疗图片分析的系统提示词 - 详细分段格式
        system_prompt = """你是一位专业的医疗影像分析助手。根据图片内容，用最详细、最专业的方式回答。

【重要要求】
1. 回答必须详细、完整，每个要点都要充分展开说明
2. 分段必须清晰，使用清晰的标题和条目
3. 禁止使用特殊符号如 ▶ ○ ● ◆ 等
4. 只描述图片中实际可见的内容，不要编造
5. 回答结构清晰、层次分明，便于阅读

【回答格式】

一、影像概述
对本张影像检查进行总体描述，包括检查类型、拍摄体位等基本信息。

二、主要发现（按部位分节）

（一）肺部表现
• 双肺野透亮度：xxx
• 肺纹理：xxx
• 异常阴影：xxx（如有）
• 结节/肿块：xxx（如有）

（二）心脏与纵隔
• 心脏大小：xxx
• 纵隔：xxx
• 气管：xxx

（三）骨骼系统
• 胸椎：xxx
• 肋骨：xxx
• 其他骨骼：xxx

（四）膈肌与胸膜
• 膈肌：xxx
• 胸腔：xxx

三、诊断意见
根据影像表现给出可能的诊断，区分"未见明显异常"和"需关注的异常"。

四、建议
1. 如需进一步检查，说明建议的检查项目
2. 如需临床结合，给出建议
3. 如需复查，说明复查时机

【排版要求】
• 使用中文数字（一、二、三）和中文括号（（一）（二））
• 使用圆点符号（•）作为列表项
• 每个主要部分之间留出空行
• 段落之间清晰分隔"""

        # 调用 DeepSeek Vision API
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "请仔细分析这张图片，**只描述图片中实际可见的内容**，不要添加任何推测或编造的信息。"
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_content}"
                            }
                        }
                    ]
                }
            ],
            "max_tokens": 2000,
            "temperature": 0.3  # 降低温度以减少幻觉
        }

        # 尝试调用 API
        response = requests.post(
            f"{endpoint}/chat/completions",
            headers=headers,
            json=payload,
            timeout=60
        )

        # 如果返回 400 错误，尝试 OpenAI 兼容格式（部分 API 服务商支持）
        if response.status_code == 400:
            logging.warning(f"DeepSeek 格式不支持图片，尝试使用通用 Vision API 格式")
            payload_v2 = {
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": system_prompt
                    },
                    {
                        "role": "user",
                        "content": f"![image](data:image/jpeg;base64,{image_content})\n\n请分析这张医学图片，提供详细的解读和建议。"
                    }
                ],
                "max_tokens": 2000,
                "temperature": 0.7
            }
            response = requests.post(
                f"{endpoint}/chat/completions",
                headers=headers,
                json=payload_v2,
                timeout=60
            )

        if not response.ok:
            logging.error(f"DeepSeek Vision API 错误: {response.text}")

            # 尝试使用 OpenAI API 作为备选
            openai_key = os.environ.get("OPENAI_API_KEY")
            if openai_key:
                try:
                    openai_headers = {
                        "Authorization": f"Bearer {openai_key}",
                        "Content-Type": "application/json"
                    }
                    openai_payload = {
                        "model": "gpt-4o",  # GPT-4o 支持 Vision
                        "messages": [
                            {
                                "role": "system",
                                "content": system_prompt
                            },
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": "请分析这张医学图片，提供详细的解读和建议。"
                                    },
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:image/jpeg;base64,{image_content}"
                                        }
                                    }
                                ]
                            }
                        ],
                        "max_tokens": 2000,
                        "temperature": 0.7
                    }
                    openai_response = requests.post(
                        "https://api.openai.com/v1/chat/completions",
                        headers=openai_headers,
                        json=openai_payload,
                        timeout=60
                    )
                    if openai_response.ok:
                        openai_result = openai_response.json()
                        analysis = openai_result.get('choices', [{}])[0].get('message', {}).get('content', '无法分析图片内容')
                        return jsonify({
                            "analysis": analysis,
                            "source": "OpenAI GPT-4o (DeepSeek 不支持图片)"
                        }), 200
                except Exception as oe:
                    logging.error(f"OpenAI 备选也失败: {oe}")

            return jsonify({
                "analysis": f"图片分析服务暂时不可用 (错误代码: {response.status_code})。\n\n解决方案：\n1. 当前 DeepSeek API 不支持图片识别\n2. 配置 OPENAI_API_KEY 环境变量以使用 GPT-4 Vision\n3. 安装本地 Ollama llava 模型",
                "error": response.text[:500]
            }), 500

        result = response.json()
        analysis = result.get('choices', [{}])[0].get('message', {}).get('content', '无法分析图片内容')
        
        # 记录分析结果长度，方便调试
        logging.info(f"图片分析结果长度: {len(analysis) if analysis else 0} 字符")
        logging.info(f"图片分析结果前500字: {analysis[:500] if analysis else '无内容'}")
        
        return jsonify({"analysis": analysis}), 200

    except requests.exceptions.Timeout:
        logging.error("图片分析超时")
        return jsonify({"analysis": "图片分析超时，请尝试使用更小的图片。"}), 500
    except Exception as e:
        logging.error(f"图片分析失败: {e}", exc_info=True)
        return jsonify({"analysis": f"图片分析失败: {str(e)}"}), 500


# ==================== 医生端排班管理 ====================

@app.route("/doctor/schedules", methods=["GET"])
def get_doctor_schedules():
    """医生获取自己的排班列表"""
    try:
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({"error": "请先登录"}), 401
        
        try:
            token_data = serializer.loads(token)
            doctor_username = token_data.get('username')
            user_role = token_data.get('role') or token_data.get('user_type')
            if user_role != 'doctor' and user_role != 'admin':
                return jsonify({"error": "仅医生可访问"}), 403
        except Exception:
            return jsonify({"error": "登录已过期"}), 401
        
        conn = get_db_conn()
        cur = conn.cursor()
        
        # 获取未来7天的排班
        cur.execute("""
            SELECT id, date, start_time, end_time, max_appointments, current_appointments, is_available
            FROM doctor_schedules
            WHERE doctor_username = ? AND date >= date('now')
            ORDER BY date, start_time
        """, (doctor_username,))
        
        schedules = cur.fetchall()
        conn.close()

        result = []
        for s in schedules:
            is_avail = s[6] if s[6] is not None else 1
            max_appts = s[4] if s[4] is not None else 10
            curr_appts = s[5] if s[5] is not None else 0
            result.append({
                "id": s[0],
                "date": s[1],
                "start_time": s[2],
                "end_time": s[3],
                "max_appointments": max_appts,
                "current_appointments": curr_appts,
                "available": max_appts - curr_appts,
                "is_available": is_avail
            })

        return jsonify({"schedules": result}), 200
    except Exception as e:
        logging.error(f"获取排班失败: {e}", exc_info=True)
        return jsonify({"error": "获取排班失败"}), 500


@app.route("/doctor/schedules", methods=["POST"])
def add_doctor_schedule():
    """医生添加排班"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求数据为空"}), 400
        
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({"error": "请先登录"}), 401
        
        try:
            token_data = serializer.loads(token)
            doctor_username = token_data.get('username')
        except Exception:
            return jsonify({"error": "登录已过期"}), 401
        
        date = data.get("date", "").strip()  # YYYY-MM-DD
        start_time = data.get("start_time", "").strip()  # HH:MM
        end_time = data.get("end_time", "").strip()
        max_appointments = data.get("max_appointments", 10)
        
        if not date or not start_time or not end_time:
            return jsonify({"error": "请填写完整的排班信息"}), 400
        
        conn = get_db_conn()
        cur = conn.cursor()
        
        # 检查是否已存在相同时间段的排班
        cur.execute("""
            SELECT id FROM doctor_schedules
            WHERE doctor_username = ? AND date = ? AND start_time = ?
        """, (doctor_username, date, start_time))
        if cur.fetchone():
            conn.close()
            return jsonify({"error": "该时间段已存在排班"}), 400
        
        now = int(time.time())
        cur.execute("""
            INSERT INTO doctor_schedules (doctor_username, date, start_time, end_time, max_appointments, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (doctor_username, date, start_time, end_time, max_appointments, now))
        
        schedule_id = cur.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({
            "message": "排班添加成功",
            "schedule": {
                "id": schedule_id,
                "date": date,
                "start_time": start_time,
                "end_time": end_time,
                "max_appointments": max_appointments
            }
        }), 201
    except Exception as e:
        logging.error(f"添加排班失败: {e}", exc_info=True)
        return jsonify({"error": "添加排班失败"}), 500


@app.route("/doctor/schedules/<int:schedule_id>", methods=["DELETE"])
def delete_doctor_schedule(schedule_id):
    """医生删除排班"""
    try:
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({"error": "请先登录"}), 401
        
        try:
            token_data = serializer.loads(token)
            doctor_username = token_data.get('username')
        except Exception:
            return jsonify({"error": "登录已过期"}), 401
        
        conn = get_db_conn()
        cur = conn.cursor()
        
        # 检查排班是否存在且属于该医生
        cur.execute("SELECT doctor_username FROM doctor_schedules WHERE id = ?", (schedule_id,))
        schedule = cur.fetchone()
        
        if not schedule:
            conn.close()
            return jsonify({"error": "排班不存在"}), 404
        
        if schedule[0] != doctor_username:
            conn.close()
            return jsonify({"error": "无权删除此排班"}), 403
        
        # 检查是否有已确认的预约
        cur.execute("SELECT COUNT(*) FROM appointments WHERE schedule_id = ? AND status = 'scheduled'", (schedule_id,))
        if cur.fetchone()[0] > 0:
            conn.close()
            return jsonify({"error": "该排班有待确认的预约，无法删除"}), 400
        
        cur.execute("DELETE FROM doctor_schedules WHERE id = ?", (schedule_id,))
        conn.commit()
        conn.close()
        
        return jsonify({"message": "排班已删除"}), 200
    except Exception as e:
        logging.error(f"删除排班失败: {e}", exc_info=True)
        return jsonify({"error": "删除排班失败"}), 500


# ==================== 管理员排班管理 API ====================

@app.route("/admin/schedules", methods=["GET"])
def admin_list_schedules():
    """获取所有排班列表（管理员用）"""
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        doctor_filter = request.args.get('doctor')
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')

        conn = get_db_conn()
        cur = conn.cursor()

        query = """
            SELECT s.id, s.doctor_username, s.date, s.start_time, s.end_time,
                   s.max_appointments, s.current_appointments, s.is_available, s.fee, s.created_at,
                   d.display_name, d.clinic, d.specialties
            FROM doctor_schedules s
            LEFT JOIN users_doctor d ON s.doctor_username = d.username
            WHERE 1=1
        """
        params = []

        if doctor_filter:
            query += " AND s.doctor_username = ?"
            params.append(doctor_filter)
        if date_from:
            query += " AND s.date >= ?"
            params.append(date_from)
        if date_to:
            query += " AND s.date <= ?"
            params.append(date_to)

        query += " ORDER BY s.date DESC, s.start_time"

        cur.execute(query, params)
        rows = cur.fetchall()
        conn.close()

        result = []
        for r in rows:
            max_appts = r[5] if r[5] is not None else 10
            curr_appts = r[6] if r[6] is not None else 0
            is_avail = r[7] if r[7] is not None else 1
            result.append({
                "id": r[0],
                "doctor_username": r[1],
                "date": r[2],
                "start_time": r[3],
                "end_time": r[4],
                "max_appointments": max_appts,
                "current_appointments": curr_appts,
                "is_available": is_avail,
                "fee": r[8],
                "created_at": r[9],
                "doctor_name": r[10] or r[1],
                "doctor_clinic": r[11] or "",
                "doctor_specialties": r[12] or "",
                "remaining": max_appts - curr_appts
            })
        return jsonify(result), 200
    except Exception as e:
        logging.error(f"admin_list_schedules failed: {e}", exc_info=True)
        return jsonify({"error": "获取排班列表失败"}), 500


@app.route("/admin/schedules", methods=["POST"])
def admin_create_schedule():
    """创建排班（管理员）"""
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        data = request.get_json() or {}
        doctor_username = data.get("doctor_username", "").strip()
        date = data.get("date", "").strip()
        start_time = data.get("start_time", "").strip()
        end_time = data.get("end_time", "").strip()
        max_appointments = data.get("max_appointments", 10)
        fee = data.get("fee", 0)

        if not doctor_username or not date or not start_time or not end_time:
            return jsonify({"error": "请填写完整的排班信息"}), 400

        conn = get_db_conn()
        cur = conn.cursor()

        # 检查医生是否存在
        cur.execute("SELECT id FROM users_doctor WHERE username = ? AND is_deleted = 0", (doctor_username,))
        if not cur.fetchone():
            conn.close()
            return jsonify({"error": "医生不存在"}), 404

        # 检查是否已存在相同时间段的排班
        cur.execute("""
            SELECT id FROM doctor_schedules
            WHERE doctor_username = ? AND date = ? AND start_time = ? AND end_time = ?
        """, (doctor_username, date, start_time, end_time))
        if cur.fetchone():
            conn.close()
            return jsonify({"error": "该时间段已存在排班"}), 400

        now = int(time.time())
        cur.execute("""
            INSERT INTO doctor_schedules (doctor_username, date, start_time, end_time, max_appointments, fee, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (doctor_username, date, start_time, end_time, max_appointments, fee, now))

        schedule_id = cur.lastrowid
        conn.commit()
        conn.close()

        return jsonify({"message": "排班添加成功", "id": schedule_id}), 201
    except Exception as e:
        logging.error(f"admin_create_schedule failed: {e}", exc_info=True)
        return jsonify({"error": "添加排班失败"}), 500


@app.route("/admin/schedules/<int:schedule_id>", methods=["PUT"])
def admin_update_schedule(schedule_id):
    """更新排班（管理员）"""
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        data = request.get_json() or {}

        conn = get_db_conn()
        cur = conn.cursor()

        # 检查排班是否存在
        cur.execute("SELECT id, max_appointments, current_appointments FROM doctor_schedules WHERE id = ?", (schedule_id,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return jsonify({"error": "排班不存在"}), 404

        old_max = row[1]
        old_current = row[2]

        # 构建更新语句
        update_fields = []
        update_values = []

        for field in ['date', 'start_time', 'end_time', 'max_appointments', 'fee', 'is_available']:
            if field in data:
                update_fields.append(f"{field} = ?")
                update_values.append(data[field])

        if update_fields:
            # 如果新的max_appointments小于已预约数，不允许
            new_max = data.get('max_appointments', old_max)
            if new_max < old_current:
                conn.close()
                return jsonify({"error": f"最大预约数不能小于已预约数（{old_current}）"}), 400

            update_values.append(schedule_id)
            query = f"UPDATE doctor_schedules SET {', '.join(update_fields)} WHERE id = ?"
            cur.execute(query, update_values)
            conn.commit()

        conn.close()
        return jsonify({"message": "排班更新成功"}), 200
    except Exception as e:
        logging.error(f"admin_update_schedule failed: {e}", exc_info=True)
        return jsonify({"error": "更新排班失败"}), 500


@app.route("/admin/schedules/<int:schedule_id>", methods=["DELETE"])
def admin_delete_schedule(schedule_id):
    """删除排班（管理员）"""
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        conn = get_db_conn()
        cur = conn.cursor()

        # 检查排班是否存在
        cur.execute("SELECT id FROM doctor_schedules WHERE id = ?", (schedule_id,))
        if not cur.fetchone():
            conn.close()
            return jsonify({"error": "排班不存在"}), 404

        # 检查是否有已确认的预约
        cur.execute("SELECT COUNT(*) FROM appointments WHERE schedule_id = ?", (schedule_id,))
        if cur.fetchone()[0] > 0:
            conn.close()
            return jsonify({"error": "该排班有预约记录，无法删除"}), 400

        cur.execute("DELETE FROM doctor_schedules WHERE id = ?", (schedule_id,))
        conn.commit()
        conn.close()

        return jsonify({"message": "排班已删除"}), 200
    except Exception as e:
        logging.error(f"admin_delete_schedule failed: {e}", exc_info=True)
        return jsonify({"error": "删除排班失败"}), 500


@app.route("/admin/schedules/batch", methods=["POST"])
def admin_batch_create_schedules():
    """批量创建排班（管理员）"""
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        data = request.get_json() or {}
        doctor_username = data.get("doctor_username", "").strip()
        start_date = data.get("start_date", "").strip()
        end_date = data.get("end_date", "").strip()
        template = data.get("template", {})  # { "1": [{"start": "08:00", "end": "12:00", "fee": 50}], ... }

        if not doctor_username or not start_date or not end_date:
            return jsonify({"error": "请选择医生和日期范围"}), 400

        from datetime import datetime, timedelta

        try:
            start = datetime.strptime(start_date, "%Y-%m-%d")
            end = datetime.strptime(end_date, "%Y-%m-%d")
        except ValueError:
            return jsonify({"error": "日期格式错误，请使用 YYYY-MM-DD"}), 400

        if start > end:
            return jsonify({"error": "开始日期不能晚于结束日期"}), 400

        conn = get_db_conn()
        cur = conn.cursor()

        # 检查医生是否存在
        cur.execute("SELECT id FROM users_doctor WHERE username = ? AND is_deleted = 0", (doctor_username,))
        if not cur.fetchone():
            conn.close()
            return jsonify({"error": "医生不存在"}), 404

        now = int(time.time())
        created_count = 0
        skipped_count = 0

        current = start
        while current <= end:
            weekday = str(current.weekday() + 1)  # 1=周一, 7=周日
            day_schedules = template.get(weekday, [])

            for sched in day_schedules:
                start_time = sched.get("start", "")
                end_time = sched.get("end", "")
                max_appts = sched.get("max_appointments", 10)
                fee = sched.get("fee", 0)

                if not start_time or not end_time:
                    continue

                date_str = current.strftime("%Y-%m-%d")

                # 检查是否已存在
                cur.execute("""
                    SELECT id FROM doctor_schedules
                    WHERE doctor_username = ? AND date = ? AND start_time = ? AND end_time = ?
                """, (doctor_username, date_str, start_time, end_time))

                if cur.fetchone():
                    skipped_count += 1
                    continue

                cur.execute("""
                    INSERT INTO doctor_schedules (doctor_username, date, start_time, end_time, max_appointments, fee, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (doctor_username, date_str, start_time, end_time, max_appts, fee, now))
                created_count += 1

            current += timedelta(days=1)

        conn.commit()
        conn.close()

        return jsonify({
            "message": f"批量排班完成",
            "created": created_count,
            "skipped": skipped_count
        }), 201
    except Exception as e:
        logging.error(f"admin_batch_create_schedules failed: {e}", exc_info=True)
        return jsonify({"error": "批量排班失败"}), 500


@app.route("/admin/schedules/doctor/<doctor_username>", methods=["GET"])
def admin_get_doctor_schedules(doctor_username):
    """获取指定医生的所有排班（管理员用）"""
    admin_user = admin_auth_username()
    if not admin_user:
        return jsonify({"error": "未授权"}), 401
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT s.id, s.doctor_username, s.date, s.start_time, s.end_time,
                   s.max_appointments, s.current_appointments, s.is_available, s.fee, s.created_at
            FROM doctor_schedules s
            WHERE s.doctor_username = ?
            ORDER BY s.date DESC, s.start_time
        """, (doctor_username,))
        rows = cur.fetchall()
        conn.close()

        result = []
        for r in rows:
            max_appts = r[5] if r[5] is not None else 10
            curr_appts = r[6] if r[6] is not None else 0
            is_avail = r[7] if r[7] is not None else 1
            result.append({
                "id": r[0],
                "doctor_username": r[1],
                "date": r[2],
                "start_time": r[3],
                "end_time": r[4],
                "max_appointments": max_appts,
                "current_appointments": curr_appts,
                "is_available": is_avail,
                "fee": r[8],
                "created_at": r[9],
                "remaining": max_appts - curr_appts
            })
        return jsonify(result), 200
    except Exception as e:
        logging.error(f"admin_get_doctor_schedules failed: {e}", exc_info=True)
        return jsonify({"error": "获取医生排班失败"}), 500


# ==================== 患者端医生排班（公开）====================
@app.route("/doctors/<doctor_username>/schedules", methods=["GET"])
def get_doctor_schedules_public(doctor_username):
    """获取特定医生的排班列表（公开接口，用于患者端）"""
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        
        # 获取日期参数
        date = request.args.get('date')
        
        if date:
            # 获取指定日期的排班
            cur.execute("""
                SELECT id, date, start_time, end_time, max_appointments, current_appointments, is_available
                FROM doctor_schedules
                WHERE doctor_username = ? AND date = ?
                ORDER BY start_time
            """, (doctor_username, date))
        else:
            # 获取未来7天的排班
            cur.execute("""
                SELECT id, date, start_time, end_time, max_appointments, current_appointments, is_available
                FROM doctor_schedules
                WHERE doctor_username = ? AND date >= date('now')
                ORDER BY date, start_time
            """, (doctor_username,))
        
        schedules = cur.fetchall()
        conn.close()

        result = []
        for s in schedules:
            is_avail = s[6] if s[6] is not None else 1
            max_appts = s[4] if s[4] is not None else 10
            curr_appts = s[5] if s[5] is not None else 0
            result.append({
                "id": s[0],
                "date": s[1],
                "start_time": s[2],
                "end_time": s[3],
                "max_appointments": max_appts,
                "current_appointments": curr_appts,
                "available": max_appts - curr_appts,
                "is_available": is_avail
            })

        return jsonify({"schedules": result}), 200
    except Exception as e:
        logging.error(f"获取医生排班失败: {e}", exc_info=True)
        return jsonify({"error": "获取排班失败"}), 500


# ==================== 预约相关API ====================

@app.route("/appointments", methods=["POST"])
def create_appointment():
    """患者创建预约"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求数据为空"}), 400

        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({"error": "请先登录"}), 401

        try:
            token_data = serializer.loads(token)
            patient_username = token_data.get('username')
        except Exception:
            return jsonify({"error": "登录已过期"}), 401

        schedule_id = data.get("schedule_id")
        doctor_username = data.get("doctor_username")
        patient_name = data.get("patient_name", "")
        patient_phone = data.get("patient_phone", "")
        notes = data.get("notes", "")
        department_id = data.get("department_id")

        if not schedule_id or not doctor_username:
            return jsonify({"error": "请选择排班时间和医生"}), 400

        conn = get_db_conn()
        cur = conn.cursor()

        # 检查是否已预约过相同排班（这个可以在原子操作前检查）
        cur.execute("""
            SELECT id FROM appointments
            WHERE patient_username = ? AND schedule_id = ? AND status != 'cancelled'
        """, (patient_username, schedule_id))
        if cur.fetchone():
            conn.close()
            return jsonify({"error": "您已预约过该时段"}), 400

        # 原子操作：先尝试更新号源（只有号源充足时才能成功）
        # 使用 UPDATE ... WHERE 条件来实现原子检查
        cur.execute("""
            UPDATE doctor_schedules 
            SET current_appointments = current_appointments + 1 
            WHERE id = ? 
              AND is_available = 1 
              AND current_appointments < max_appointments
        """, (schedule_id,))

        if cur.rowcount == 0:
            # 更新失败，说明号源已满或排班不可用
            conn.rollback()
            
            # 检查具体原因
            cur.execute("""
                SELECT is_available, current_appointments, max_appointments
                FROM doctor_schedules WHERE id = ?
            """, (schedule_id,))
            schedule_info = cur.fetchone()
            
            conn.close()
            
            if not schedule_info:
                return jsonify({"error": "排班不存在"}), 404
            elif schedule_info[0] == 0:
                return jsonify({"error": "该时段已不可预约"}), 400
            else:
                return jsonify({"error": "该时段已约满"}), 400

        # 获取排班详情（用于返回给前端）
        cur.execute("""
            SELECT id, date, start_time, end_time, max_appointments, current_appointments, is_available
            FROM doctor_schedules WHERE id = ?
        """, (schedule_id,))
        schedule = cur.fetchone()

        now = int(time.time())
        # 计算时间戳
        date_str = schedule[1]  # YYYY-MM-DD
        start_time_str = schedule[2]  # HH:MM
        from datetime import datetime
        start_ts = int(datetime.strptime(f"{date_str} {start_time_str}", "%Y-%m-%d %H:%M").timestamp())
        end_ts = start_ts + 30 * 60  # 假设每个预约30分钟

        # 创建预约
        cur.execute("""
            INSERT INTO appointments (case_id, doctor_username, patient_username, patient_name, patient_phone,
                                     start_ts, end_ts, status, department_id, notes, schedule_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (None, doctor_username, patient_username, patient_name, patient_phone,
              start_ts, end_ts, 'scheduled', department_id, notes, schedule_id, now))

        appointment_id = cur.lastrowid

        conn.commit()
        conn.close()

        return jsonify({
            "message": "预约成功",
            "appointment": {
                "id": appointment_id,
                "doctor_username": doctor_username,
                "patient_username": patient_username,
                "patient_name": patient_name,
                "patient_phone": patient_phone,
                "date": date_str,
                "start_time": start_time_str,
                "end_time": schedule[3],
                "status": "scheduled",
                "notes": notes
            }
        }), 201
    except Exception as e:
        logging.error(f"创建预约失败: {e}", exc_info=True)
        return jsonify({"error": "创建预约失败"}), 500


@app.route("/patient/appointments", methods=["GET"])
def get_patient_appointments():
    """获取患者的所有预约"""
    try:
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({"error": "请先登录"}), 401

        try:
            token_data = serializer.loads(token)
            patient_username = token_data.get('username')
        except Exception:
            return jsonify({"error": "登录已过期"}), 401

        status_filter = request.args.get('status', '')

        conn = get_db_conn()
        cur = conn.cursor()

        query = """
            SELECT a.id, a.doctor_username, a.patient_username, a.patient_name, a.patient_phone,
                   a.start_ts, a.end_ts, a.status, a.notes, a.schedule_id, a.department_id, a.case_id,
                   d.display_name as doctor_name, d.avatar_url as doctor_avatar, d.clinic,
                   s.date, s.start_time, s.end_time
            FROM appointments a
            LEFT JOIN users_doctor d ON a.doctor_username = d.username
            LEFT JOIN doctor_schedules s ON a.schedule_id = s.id
            WHERE a.patient_username = ?
        """
        params = [patient_username]

        if status_filter:
            query += " AND a.status = ?"
            params.append(status_filter)

        query += " ORDER BY a.start_ts DESC"

        cur.execute(query, params)
        rows = cur.fetchall()
        conn.close()

        appointments = []
        for r in rows:
            from datetime import datetime
            start_dt = datetime.fromtimestamp(r[5]) if r[5] else None
            appointments.append({
                "id": r[0],
                "doctor_username": r[1],
                "patient_username": r[2],
                "patient_name": r[3],
                "patient_phone": r[4],
                "start_ts": r[5],
                "end_ts": r[6],
                "status": r[7],
                "notes": r[8],
                "schedule_id": r[9],
                "department_id": r[10],
                "case_id": r[11],
                "doctor_name": r[12],
                "doctor_avatar": r[13],
                "doctor_clinic": r[14],
                "date": r[15],
                "start_time": r[16],
                "end_time": r[17],
                "start_date": start_dt.strftime("%Y-%m-%d") if start_dt else "",
                "start_hour": start_dt.strftime("%H:%M") if start_dt else ""
            })

        return jsonify({"appointments": appointments}), 200
    except Exception as e:
        logging.error(f"获取患者预约失败: {e}", exc_info=True)
        return jsonify({"error": "获取预约失败"}), 500


@app.route("/doctor/appointments", methods=["GET"])
def get_doctor_appointments():
    """获取医生的所有预约"""
    try:
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({"error": "请先登录"}), 401

        try:
            token_data = serializer.loads(token)
            doctor_username = token_data.get('username')
        except Exception:
            return jsonify({"error": "登录已过期"}), 401

        status_filter = request.args.get('status', '')

        conn = get_db_conn()
        cur = conn.cursor()

        query = """
            SELECT a.id, a.doctor_username, a.patient_username, a.patient_name, a.patient_phone,
                   a.start_ts, a.end_ts, a.status, a.notes, a.schedule_id, a.department_id,
                   u.display_name as patient_name_db, u.avatar_url as patient_avatar,
                   s.date, s.start_time, s.end_time, a.case_id
            FROM appointments a
            LEFT JOIN users u ON a.patient_username = u.username
            LEFT JOIN doctor_schedules s ON a.schedule_id = s.id
            WHERE a.doctor_username = ?
        """
        params = [doctor_username]

        if status_filter:
            query += " AND a.status = ?"
            params.append(status_filter)

        query += " ORDER BY a.start_ts ASC"

        cur.execute(query, params)
        rows = cur.fetchall()
        conn.close()

        appointments = []
        for r in rows:
            from datetime import datetime
            start_dt = datetime.fromtimestamp(r[5]) if r[5] else None
            appointments.append({
                "id": r[0],
                "doctor_username": r[1],
                "patient_username": r[2],
                "patient_name": r[3] or r[11],
                "patient_phone": r[4],
                "start_ts": r[5],
                "end_ts": r[6],
                "status": r[7],
                "notes": r[8],
                "schedule_id": r[9],
                "department_id": r[10],
                "patient_avatar": r[12],
                "date": r[13],
                "start_time": r[14],
                "end_time": r[15],
                "start_date": start_dt.strftime("%Y-%m-%d") if start_dt else "",
                "start_hour": start_dt.strftime("%H:%M") if start_dt else "",
                "case_id": r[16] if len(r) > 16 else None
            })

        return jsonify({"appointments": appointments}), 200
    except Exception as e:
        logging.error(f"获取医生预约失败: {e}", exc_info=True)
        return jsonify({"error": "获取预约失败"}), 500


@app.route("/appointments/<int:aid>/cancel", methods=["POST"])
def cancel_appointment(aid):
    """取消预约"""
    try:
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({"error": "请先登录"}), 401

        try:
            token_data = serializer.loads(token)
            username = token_data.get('username')
            user_type = token_data.get('user_type', 'patient')
        except Exception:
            return jsonify({"error": "登录已过期"}), 401

        conn = get_db_conn()
        cur = conn.cursor()

        # 检查预约是否存在
        cur.execute("""
            SELECT id, doctor_username, patient_username, schedule_id, status
            FROM appointments WHERE id = ?
        """, (aid,))
        appointment = cur.fetchone()

        if not appointment:
            conn.close()
            return jsonify({"error": "预约不存在"}), 404

        # 检查权限（患者本人或医生或管理员）
        if user_type != 'admin' and username != appointment[2] and username != appointment[1]:
            conn.close()
            return jsonify({"error": "无权取消此预约"}), 403

        current_status = appointment[4]
        if current_status == 'cancelled':
            conn.close()
            return jsonify({"error": "预约已取消"}), 400

        if current_status == 'completed':
            conn.close()
            return jsonify({"error": "已完成预约无法取消"}), 400

        # 原子操作：同时更新预约状态和排班数
        # 只有在预约状态为非取消时才执行
        if appointment[3]:  # schedule_id 存在
            cur.execute("""
                UPDATE doctor_schedules 
                SET current_appointments = current_appointments - 1 
                WHERE id = ? AND current_appointments > 0
            """, (appointment[3],))
        
        # 更新预约状态
        cur.execute("UPDATE appointments SET status = 'cancelled' WHERE id = ?", (aid,))

        conn.commit()
        conn.close()

        return jsonify({"message": "预约已取消"}), 200
    except Exception as e:
        logging.error(f"取消预约失败: {e}", exc_info=True)
        return jsonify({"error": "取消预约失败"}), 500


@app.route("/appointments/<int:aid>/chat", methods=["GET"])
def get_appointment_chat(aid):
    """通过预约ID获取会话信息"""
    try:
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({"error": "请先登录"}), 401

        try:
            token_data = serializer.loads(token)
            patient_username = token_data.get('username')
        except Exception:
            return jsonify({"error": "登录已过期"}), 401

        conn = get_db_conn()
        cur = conn.cursor()

        # 检查预约是否存在且属于当前患者
        cur.execute("""
            SELECT a.id, a.doctor_username, a.patient_username, a.patient_name, a.status,
                   a.case_id, a.start_ts, a.end_ts, a.notes,
                   d.display_name as doctor_name, d.avatar_url as doctor_avatar, d.clinic, d.specialties, d.bio,
                   s.date, s.start_time, s.end_time
            FROM appointments a
            LEFT JOIN users_doctor d ON a.doctor_username = d.username
            LEFT JOIN doctor_schedules s ON a.schedule_id = s.id
            WHERE a.id = ? AND a.patient_username = ?
        """, (aid, patient_username))
        appt = cur.fetchone()

        if not appt:
            conn.close()
            return jsonify({"error": "预约不存在或无权访问"}), 404

        appointment_data = {
            "id": appt[0],
            "doctor_username": appt[1],
            "patient_username": appt[2],
            "patient_name": appt[3],
            "status": appt[4],
            "case_id": appt[5],
            "start_ts": appt[6],
            "end_ts": appt[7],
            "notes": appt[8],
            "doctor_name": appt[9],
            "doctor_avatar": appt[10],
            "clinic": appt[11],
            "specialties": appt[12],
            "bio": appt[13],
            "date": appt[14],
            "start_time": appt[15],
            "end_time": appt[16]
        }

        # 如果有case_id，加载会话消息
        case_id = appt[5]
        messages = []
        if case_id:
            cur.execute("SELECT id, owner, title, messages, created_at, updated_at, status, assigned_doctor FROM cases WHERE id = ?", (case_id,))
            case_row = cur.fetchone()
            if case_row:
                try:
                    msgs = json.loads(case_row[3]) if case_row[3] else []
                except Exception:
                    msgs = []
                messages = msgs
                appointment_data["case"] = {
                    "id": case_row[0],
                    "owner": case_row[1],
                    "title": case_row[2],
                    "messages": msgs,
                    "created_at": case_row[4],
                    "updated_at": case_row[5],
                    "status": case_row[6],
                    "assigned_doctor": case_row[7]
                }

        conn.close()
        return jsonify({"appointment": appointment_data, "messages": messages}), 200

    except Exception as e:
        logging.error(f"获取预约会话失败: {e}", exc_info=True)
        return jsonify({"error": "获取会话信息失败"}), 500


@app.route("/appointments/<int:aid>/confirm", methods=["POST"])
def confirm_appointment(aid):
    """医生确认预约"""
    try:
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({"error": "请先登录"}), 401

        try:
            token_data = serializer.loads(token)
            doctor_username = token_data.get('username')
        except Exception:
            return jsonify({"error": "登录已过期"}), 401

        conn = get_db_conn()
        cur = conn.cursor()

        # 检查预约是否存在
        cur.execute("SELECT id, doctor_username, patient_username, patient_name, status FROM appointments WHERE id = ?", (aid,))
        appointment = cur.fetchone()

        if not appointment:
            conn.close()
            return jsonify({"error": "预约不存在"}), 404

        if appointment[1] != doctor_username:
            conn.close()
            return jsonify({"error": "无权操作此预约"}), 403

        if appointment[4] != 'scheduled':
            conn.close()
            return jsonify({"error": "预约状态无法确认"}), 400

        patient_username = appointment[2]
        patient_name = appointment[3]

        # 检查是否已有关联的问诊记录
        cur.execute("SELECT id, case_id FROM appointments WHERE id = ?", (aid,))
        existing_apt = cur.fetchone()

        case_id = None
        if not existing_apt[1]:  # case_id is NULL
            # 自动创建问诊记录
            now = int(time.time())
            temp_id = f"case_{now}_{aid}"
            cur.execute("""
                INSERT INTO cases (id, owner, assigned_doctor, title, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'in_progress', ?, ?)
            """, (temp_id, patient_username, doctor_username, f"预约问诊-{patient_name or patient_username}", now, now))
            case_id = temp_id

            # 更新预约，关联问诊记录
            cur.execute("UPDATE appointments SET status = 'confirmed', case_id = ? WHERE id = ?", (temp_id, aid))
        else:
            case_id = existing_apt[1]
            cur.execute("UPDATE appointments SET status = 'confirmed' WHERE id = ?", (aid,))

        conn.commit()
        conn.close()

        return jsonify({"message": "预约已确认", "case_id": case_id}), 200
    except Exception as e:
        logging.error(f"确认预约失败: {e}", exc_info=True)
        return jsonify({"error": "确认预约失败"}), 500


@app.route("/admin/appointments", methods=["GET"])
def get_all_appointments_admin():
    """管理员获取所有预约"""
    try:
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({"error": "请先登录"}), 401

        try:
            token_data = serializer.loads(token)
            if token_data.get('user_type') != 'admin' and token_data.get('role') != 'admin':
                return jsonify({"error": "权限不足"}), 403
        except Exception:
            return jsonify({"error": "登录已过期"}), 401

        status_filter = request.args.get('status', '')
        doctor_filter = request.args.get('doctor_username', '')

        conn = get_db_conn()
        cur = conn.cursor()

        query = """
            SELECT a.id, a.doctor_username, a.patient_username, a.patient_name, a.patient_phone,
                   a.start_ts, a.end_ts, a.status, a.notes, a.schedule_id, a.department_id,
                   d.display_name as doctor_name, d.clinic,
                   p.display_name as patient_name_db,
                   s.date, s.start_time, s.end_time
            FROM appointments a
            LEFT JOIN users_doctor d ON a.doctor_username = d.username
            LEFT JOIN users p ON a.patient_username = p.username
            LEFT JOIN doctor_schedules s ON a.schedule_id = s.id
            WHERE 1=1
        """
        params = []

        if status_filter:
            query += " AND a.status = ?"
            params.append(status_filter)

        if doctor_filter:
            query += " AND a.doctor_username = ?"
            params.append(doctor_filter)

        query += " ORDER BY a.start_ts DESC"

        cur.execute(query, params)
        rows = cur.fetchall()
        conn.close()

        appointments = []
        for r in rows:
            from datetime import datetime
            start_dt = datetime.fromtimestamp(r[5]) if r[5] else None
            appointments.append({
                "id": r[0],
                "doctor_username": r[1],
                "patient_username": r[2],
                "patient_name": r[3] or (r[14] if len(r) > 14 else None),
                "patient_phone": r[4],
                "start_ts": r[5],
                "end_ts": r[6],
                "status": r[7],
                "notes": r[8] if len(r) > 8 else None,
                "schedule_id": r[9] if len(r) > 9 else None,
                "department_id": r[10] if len(r) > 10 else None,
                "doctor_name": r[11] if len(r) > 11 else None,
                "doctor_clinic": r[12] if len(r) > 12 else None,
                "date": r[15] if len(r) > 15 else None,
                "start_time": r[16] if len(r) > 16 else None,
                "end_time": r[17] if len(r) > 17 else None,
                "start_date": start_dt.strftime("%Y-%m-%d") if start_dt else "",
                "start_hour": start_dt.strftime("%H:%M") if start_dt else ""
            })

        return jsonify({"appointments": appointments}), 200
    except Exception as e:
        logging.error(f"获取所有预约失败: {e}", exc_info=True)
        return jsonify({"error": "获取预约失败"}), 500


# ==================== 数据统计接口 ====================

@app.route("/admin/stats", methods=["GET"])
def get_admin_stats():
    """获取平台统计数据"""
    try:
        admin_user = admin_auth_username()
        if not admin_user:
            return jsonify({"error": "未授权"}), 401

        conn = get_db_conn()
        cur = conn.cursor()

        # 患者总数
        cur.execute("SELECT COUNT(*) FROM users WHERE is_admin = 0")
        patients = cur.fetchone()[0]

        # 医生总数
        cur.execute("SELECT COUNT(*) FROM users_doctor")
        doctors = cur.fetchone()[0]

        # 认证医生数
        cur.execute("SELECT COUNT(*) FROM users_doctor WHERE verified = 1")
        verified_doctors = cur.fetchone()[0]

        # 预约总数
        cur.execute("SELECT COUNT(*) FROM appointments")
        appointments = cur.fetchone()[0]

        # 已完成预约
        cur.execute("SELECT COUNT(*) FROM appointments WHERE status = 'completed'")
        completed_appointments = cur.fetchone()[0]

        # 咨询病例数
        cur.execute("SELECT COUNT(*) FROM cases")
        cases = cur.fetchone()[0]

        # 科室数
        cur.execute("SELECT COUNT(*) FROM departments")
        departments = cur.fetchone()[0]

        conn.close()

        return jsonify({
            "patients": patients,
            "doctors": doctors,
            "verifiedDoctors": verified_doctors,
            "appointments": appointments,
            "completedAppointments": completed_appointments,
            "cases": cases,
            "departments": departments
        }), 200
    except Exception as e:
        logging.error(f"获取统计数据失败: {e}", exc_info=True)
        return jsonify({"error": "获取统计数据失败"}), 500


@app.route("/admin/department-stats", methods=["GET"])
def get_department_stats():
    """获取各科室统计数据"""
    try:
        admin_user = admin_auth_username()
        if not admin_user:
            return jsonify({"error": "未授权"}), 401

        conn = get_db_conn()
        cur = conn.cursor()

        # 各科室医生分布
        cur.execute("""
            SELECT d.id, d.name, COUNT(dr.id) as doctor_count
            FROM departments d
            LEFT JOIN users_doctor dr ON dr.department_id = d.id AND dr.verified = 1
            GROUP BY d.id
            ORDER BY doctor_count DESC
        """)
        rows = cur.fetchall()
        conn.close()

        stats = [{"id": r[0], "name": r[1], "doctor_count": r[2]} for r in rows]
        return jsonify(stats), 200
    except Exception as e:
        logging.error(f"获取科室统计失败: {e}", exc_info=True)
        return jsonify({"error": "获取科室统计失败"}), 500


@app.route("/admin/revenue", methods=["GET"])
def get_admin_revenue():
    """获取收入统计数据"""
    try:
        admin_user = admin_auth_username()
        if not admin_user:
            return jsonify({"error": "未授权"}), 401

        conn = get_db_conn()
        cur = conn.cursor()

        # 计算总收入（从已完成处方的总金额）
        cur.execute("""
            SELECT COALESCE(SUM(
                CAST(json_extract(value, '$.visit_fee') AS REAL) +
                (SELECT COALESCE(SUM(CAST(json_extract(m.value, '$.price') AS REAL) * CAST(json_extract(m.value, '$.qty') AS REAL)), 0)
                 FROM json_each(value, '$.medicines') AS m)
            ), 0)
            FROM cases, json_each(messages)
            WHERE json_extract(value, '$.type') = 'prescription'
        """)
        total_revenue = cur.fetchone()[0] or 0

        # 计算本月收入
        now = int(time.time())
        first_day_of_month = int(time.mktime(time.strptime(time.strftime("%Y-%m-01"), "%Y-%m-%d")))
        cur.execute("""
            SELECT COALESCE(SUM(
                CAST(json_extract(value, '$.visit_fee') AS REAL) +
                (SELECT COALESCE(SUM(CAST(json_extract(m.value, '$.price') AS REAL) * CAST(json_extract(m.value, '$.qty') AS REAL)), 0)
                 FROM json_each(value, '$.medicines') AS m)
            ), 0)
            FROM cases, json_each(messages)
            WHERE json_extract(value, '$.type') = 'prescription'
            AND CAST(json_extract(value, '$.ts') AS INTEGER) >= ?
        """, (first_day_of_month,))
        monthly_revenue = cur.fetchone()[0] or 0

        # 近7天收入趋势
        trend = []
        for i in range(6, -1, -1):
            day_start = int(time.time()) - i * 86400
            day_end = day_start + 86400
            cur.execute("""
                SELECT COALESCE(SUM(
                    CAST(json_extract(value, '$.visit_fee') AS REAL) +
                    (SELECT COALESCE(SUM(CAST(json_extract(m.value, '$.price') AS REAL) * CAST(json_extract(m.value, '$.qty') AS REAL)), 0)
                     FROM json_each(value, '$.medicines') AS m)
                ), 0)
                FROM cases, json_each(messages)
                WHERE json_extract(value, '$.type') = 'prescription'
                AND CAST(json_extract(value, '$.ts') AS INTEGER) >= ?
                AND CAST(json_extract(value, '$.ts') AS INTEGER) < ?
            """, (day_start, day_end))
            day_amount = cur.fetchone()[0] or 0
            trend.append({
                "date": time.strftime("%Y-%m-%d", time.localtime(day_start)),
                "amount": round(day_amount, 2)
            })

        conn.close()
        return jsonify({
            "totalRevenue": round(total_revenue, 2),
            "monthlyRevenue": round(monthly_revenue, 2),
            "prescriptionCount": 0,
            "trend": trend
        }), 200
    except Exception as e:
        logging.error(f"获取收入统计失败: {e}", exc_info=True)
        return jsonify({"error": "获取收入统计失败"}), 500


# ==================== 通知公告管理 ====================

def init_notifications_table():
    """初始化通知公告表"""
    conn = get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                type TEXT DEFAULT 'system',
                priority INTEGER DEFAULT 0,
                is_pinned INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                target_users TEXT,
                created_by TEXT,
                created_at INTEGER,
                updated_at INTEGER
            )
        """)
        conn.commit()
    finally:
        conn.close()


@app.route("/notifications", methods=["GET"])
def get_notifications():
    """获取通知列表（供前端展示）"""
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, title, content, type, priority, is_pinned, created_at
            FROM notifications
            WHERE is_active = 1
            ORDER BY is_pinned DESC, priority DESC, created_at DESC
            LIMIT 20
        """)
        rows = cur.fetchall()
        conn.close()
        notifications = [{
            "id": r[0],
            "title": r[1],
            "content": r[2],
            "type": r[3],
            "priority": r[4],
            "is_pinned": r[5],
            "created_at": r[6]
        } for r in rows]
        return jsonify(notifications), 200
    except Exception as e:
        logging.error(f"获取通知失败: {e}", exc_info=True)
        return jsonify({"error": "获取通知失败"}), 500


@app.route("/admin/notifications", methods=["GET"])
def admin_get_notifications():
    """后台管理：获取所有通知"""
    try:
        admin_user = admin_auth_username()
        if not admin_user:
            return jsonify({"error": "未授权"}), 401

        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, title, content, type, priority, is_pinned, is_active, target_users, created_by, created_at
            FROM notifications
            ORDER BY created_at DESC
        """)
        rows = cur.fetchall()
        conn.close()
        notifications = [{
            "id": r[0],
            "title": r[1],
            "content": r[2],
            "type": r[3],
            "priority": r[4],
            "is_pinned": bool(r[5]),
            "is_active": bool(r[6]),
            "target_users": r[7],
            "created_by": r[8],
            "created_at": r[9]
        } for r in rows]
        return jsonify(notifications), 200
    except Exception as e:
        logging.error(f"获取通知列表失败: {e}", exc_info=True)
        return jsonify({"error": "获取通知列表失败"}), 500


@app.route("/admin/notifications", methods=["POST"])
def admin_create_notification():
    """后台管理：创建通知"""
    try:
        admin_user = admin_auth_username()
        if not admin_user:
            return jsonify({"error": "未授权"}), 401

        data = request.get_json() or {}
        title = data.get("title", "").strip()
        content = data.get("content", "").strip()
        notif_type = data.get("type", "system")
        priority = int(data.get("priority", 0))
        is_pinned = 1 if data.get("is_pinned") else 0
        target_users = data.get("target_users")

        if not title or not content:
            return jsonify({"error": "标题和内容不能为空"}), 400

        now = int(time.time())
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO notifications (title, content, type, priority, is_pinned, target_users, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (title, content, notif_type, priority, is_pinned, target_users, admin_user, now, now))
        conn.commit()
        notif_id = cur.lastrowid
        conn.close()

        return jsonify({"message": "通知创建成功", "id": notif_id}), 201
    except Exception as e:
        logging.error(f"创建通知失败: {e}", exc_info=True)
        return jsonify({"error": "创建通知失败"}), 500


@app.route("/admin/notifications/<int:notif_id>", methods=["PUT"])
def admin_update_notification(notif_id):
    """后台管理：更新通知"""
    try:
        admin_user = admin_auth_username()
        if not admin_user:
            return jsonify({"error": "未授权"}), 401

        data = request.get_json() or {}
        title = data.get("title", "").strip()
        content = data.get("content", "").strip()
        notif_type = data.get("type", "system")
        priority = int(data.get("priority", 0))
        is_pinned = 1 if data.get("is_pinned") else 0
        is_active = 1 if data.get("is_active") else 0
        target_users = data.get("target_users")

        if not title or not content:
            return jsonify({"error": "标题和内容不能为空"}), 400

        now = int(time.time())
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("""
            UPDATE notifications
            SET title = ?, content = ?, type = ?, priority = ?, is_pinned = ?, is_active = ?, target_users = ?, updated_at = ?
            WHERE id = ?
        """, (title, content, notif_type, priority, is_pinned, is_active, target_users, now, notif_id))
        conn.commit()
        conn.close()

        return jsonify({"message": "通知更新成功"}), 200
    except Exception as e:
        logging.error(f"更新通知失败: {e}", exc_info=True)
        return jsonify({"error": "更新通知失败"}), 500


@app.route("/admin/notifications/<int:notif_id>", methods=["DELETE"])
def admin_delete_notification(notif_id):
    """后台管理：删除通知"""
    try:
        admin_user = admin_auth_username()
        if not admin_user:
            return jsonify({"error": "未授权"}), 401

        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("DELETE FROM notifications WHERE id = ?", (notif_id,))
        conn.commit()
        conn.close()

        return jsonify({"message": "通知已删除"}), 200
    except Exception as e:
        logging.error(f"删除通知失败: {e}", exc_info=True)
        return jsonify({"error": "删除通知失败"}), 500


if __name__ == "__main__":
    # initialize database schema and seed default data
    try:
        init_db()
        init_notifications_table()
    except Exception as e:
        logging.error(f"init_db failed: {e}", exc_info=True)
    app.run(port=8080, debug=True, use_reloader=False)
