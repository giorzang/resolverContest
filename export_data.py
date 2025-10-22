import mysql.connector
import json
from decimal import Decimal

# Nhập contestId từ bàn phím
contestId = input("Nhập contestId: ").strip()

# Kiểm tra đầu vào có phải số nguyên
if not contestId.isdigit():
    print("❌ contestId phải là số nguyên.")
    exit(1)

contestId = int(contestId)  # Chuyển về số

# Kết nối MySQL
conn = mysql.connector.connect(
    host="localhost",
    user="dmoj",
    password="root",
    database="dmoj"
)

cursor = conn.cursor()

# Truy vấn có sử dụng biến contestId
queryUser = """
    SELECT p.id AS userId, u.username AS username, u.first_name AS fullName
    FROM auth_user u
    JOIN judge_profile p ON p.user_id = u.id
    JOIN judge_contestparticipation cp ON p.id = cp.user_id
    WHERE cp.virtual = 0 AND cp.contest_id = %s;
"""
cursor.execute(queryUser, (contestId,))
rows = cursor.fetchall()
columns = [desc[0] for desc in cursor.description]
users = [dict(zip(columns, row)) for row in rows]

queryProblems = """
	SELECT p.id AS problemId, p.name AS name, cp.points AS points
	FROM judge_problem p
	JOIN judge_contestproblem cp ON p.id = cp.problem_id
	WHERE cp.contest_id = %s;
"""
cursor.execute(queryProblems, (contestId,))
rows = cursor.fetchall()
columns = [desc[0] for desc in cursor.description]
problems = [dict(zip(columns, row)) for row in rows]

querySubmissions = """
	SELECT 
	  cs.submission_id AS submissionId,
	  s.problem_id AS problemId,
	  s.user_id AS userId,
	  TIME_TO_SEC(TIMEDIFF(s.date, c.start_time)) AS time,
	  cs.points AS points
	FROM judge_contestsubmission cs
	INNER JOIN judge_submission s ON cs.submission_id = s.id
	INNER JOIN judge_contestparticipation cp ON cs.participation_id = cp.id
	INNER JOIN judge_contest c ON cp.contest_id = c.id
	WHERE cp.virtual = 0 AND c.id = %s AND s.result IN ('AC', 'WA', 'RTE', 'TLE', 'MLE', 'OLE');
"""
# AC, WA, RTE, TLE, MLE, OLE
cursor.execute(querySubmissions, (contestId,))
rows = cursor.fetchall()
columns = [desc[0] for desc in cursor.description]
submissions = [dict(zip(columns, row)) for row in rows]

def convert_decimal(obj):
    if isinstance(obj, list):
        return [convert_decimal(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: convert_decimal(v) for k, v in obj.items()}
    elif isinstance(obj, Decimal):
        return float(obj)
    else:
        return obj
# Sau khi lấy dữ liệu
users = convert_decimal(users)
problems = convert_decimal(problems)
submissions = convert_decimal(submissions)

# Export JSON
output_filename = f"{contestId}.json"
with open(output_filename, "w", encoding="utf-8") as f:
    json.dump({
    	"users": users,
    	"problems": problems,
    	"submissions": submissions
    }, f, ensure_ascii=False, indent=2)

cursor.close()
conn.close()

print(f"✅ Đã export file: {output_filename}")
