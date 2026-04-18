# ER Diagram - Real World Example

## Example: John's E-commerce Project

```
              +------------------+
              |   USER: John     |
              | - id: 101        |
              | - email: john@   |
              +--------+---------+
                       |
                       | has roles
                       |
      +----------------+----------------+
      |                                 |
+-----+----------+             +--------+--------+
| PROJECT_ROLES  |             | PROJECT_ROLES   |
| - user_id: 101 |             | - user_id: 101  |
| - proj_id: 201 |             | - proj_id: 202  |
| - role: Admin  |             | - role: Viewer  |
+-----+----------+             +-----------------+
      |
      |
+-----+------------+
|    PROJECTS      |
| - id: 201        |
| - name: Ecommerce|
+-----+------------+
      |
      | has repository
      |
+-----+------------+
|    REPO_MAP      |
| - proj_id: 201   |
| - repo_url: git..|
+-----+------------+
      |
      | triggers
      |
+-----+-----+-----+-----+-----+
|           |           |
+-----+  +--+---+  +----+----+
| RUNS|  | RUNS |  | RUNS    |
| #301|  | #302 |  | #303    |
|Deplo|  |Tests |  | Deploy  |
|Prod |  |Failed|  | Staging |
| OK  |  |      |  | OK      |
+-----+  +------+  +---------+
```

## Data Flow Story:

**Step 1: User Setup**
- John (User ID: 101) signs up

**Step 2: Project Assignment**
- John gets "Admin" role in E-commerce project (ID: 201)
- John gets "Viewer" role in Mobile App project (ID: 202)

**Step 3: Repository Connection**
- E-commerce project links to GitHub repo
- Repo URL: github.com/company/ecommerce

**Step 4: Execution History**
- Run #301: John deploys to production → Success
- Run #302: Automated tests run → Failed
- Run #303: John deploys to staging → Success

## Key Relationships:

1. **1:N (One-to-Many)**
   - One USER → Many PROJECT_ROLES
   - One PROJECT → Many REPO_MAPs
   - One REPO_MAP → Many RUNS

2. **N:1 (Many-to-One)**
   - Many PROJECT_ROLES → One PROJECT
   - Many RUNS → One REPO_MAP

This structure allows:
- Users to work on multiple projects
- Projects to have multiple team members
- Complete audit trail of all executions
