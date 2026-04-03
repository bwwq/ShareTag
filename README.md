# AI Tag Gallery

AI 绘画 Tag 展示网站。支持 OIDC 第三方登录、图片上传自动提取 Tag、内容审核、管理后台。

## 技术栈

- **后端**：Node.js + Express 5 + SQLite (sql.js)
- **认证**：OIDC (openid-client)，支持 Linux.do / GitHub 等
- **图片处理**：sharp（缩略图生成、超限自动压缩）
- **部署**：Docker + Nginx + Let's Encrypt

## 快速开始

### 本地开发

```bash
# 安装依赖
npm install

# 复制配置
cp .env.example .env

# 启动开发服务器（热重载）
npm run dev
```

服务运行在 `http://localhost:3000`

### VPS 一键部署

```bash
# 克隆项目
git clone <repo-url> && cd aitag

# 一键部署（自动安装 Docker、配置 SSL）
chmod +x deploy.sh && ./deploy.sh
```

## 项目结构

```
aitag/
├── server/
│   ├── index.js           # 入口
│   ├── app.js             # Express 应用
│   ├── db/
│   │   ├── init.js        # SQLite 初始化 + CRUD 包装
│   │   ├── schema.sql     # 表结构
│   │   └── seed.sql       # 初始配置数据
│   ├── middleware/
│   │   ├── auth.js        # 认证/角色守卫
│   │   ├── errorHandler.js
│   │   └── upload.js      # Multer 文件上传
│   ├── routes/
│   │   ├── auth.js        # OIDC 认证
│   │   ├── images.js      # 图片 CRUD
│   │   ├── tags.js        # 标签
│   │   ├── categories.js  # 分类
│   │   └── admin.js       # 管理后台
│   └── services/
│       ├── crypto.js      # AES-256 加解密
│       ├── metadata.js    # 图片元数据解析
│       ├── oidc.js        # OIDC 服务
│       ├── storage.js     # 文件存储 + 缩略图
│       └── urlValidator.js # URL 安全验证
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── nginx.conf
├── public/                 # 前端静态文件
├── uploads/                # 上传文件（自动创建）
├── data/                   # SQLite 数据库（自动创建）
├── deploy.sh              # 一键部署脚本
├── .env.example
└── package.json
```

## API 概览

| 方法     | 路径                          | 说明           | 权限     |
| -------- | ----------------------------- | -------------- | -------- |
| GET      | /api/health                   | 健康检查       | 公开     |
| GET      | /api/auth/providers           | OIDC 提供商列表 | 公开     |
| GET      | /api/auth/login/:provider     | OIDC 登录      | 公开     |
| GET      | /api/auth/me                  | 当前用户       | 登录     |
| POST     | /api/auth/logout              | 登出           | 登录     |
| GET      | /api/images                   | 图片列表       | 公开     |
| GET      | /api/images/:id               | 图片详情       | 公开     |
| POST     | /api/images/extract-tags      | 预提取 tag     | 登录     |
| POST     | /api/images                   | 上传图片       | 登录     |
| PUT      | /api/images/:id               | 修改图片       | 本人/admin |
| DELETE   | /api/images/:id               | 删除图片       | 本人/admin |
| GET      | /api/tags/popular             | 热门标签       | 公开     |
| GET      | /api/tags/search?q=           | 标签搜索       | 公开     |
| GET      | /api/categories               | 分类列表       | 公开     |
| GET      | /api/admin/dashboard          | 仪表盘数据     | admin    |
| GET/POST/PUT/DELETE | /api/admin/oidc     | OIDC 配置      | admin    |
| GET      | /api/admin/users              | 用户管理       | admin    |
| GET      | /api/admin/images             | 内容审核       | trusted+ |
| PUT      | /api/admin/images/:id/review  | 审核操作       | trusted+ |
| GET/PUT  | /api/admin/config             | 站点配置       | admin    |

## 角色体系

| 角色     | 来源                                | 权限                       |
| -------- | ----------------------------------- | -------------------------- |
| user     | 默认                                | 浏览、上传（需审核）       |
| trusted  | OIDC trust_level ≥ 3 或 admin 手动设 | 免审核上传 + 审核他人图片  |
| admin    | 首个注册用户 或 admin 手动设         | 所有功能                   |

> 角色只升不降：admin 手动设置的角色不会被 OIDC 登录覆盖。

## 环境变量

| 变量            | 说明                     | 默认值   |
| --------------- | ------------------------ | -------- |
| PORT            | 服务端口                 | 3000     |
| NODE_ENV        | 环境                     | development |
| SESSION_SECRET  | Session 加密密钥（必填） | -        |
| FRONTEND_URL    | 前端地址（OIDC 回调）    | -        |
| UPLOAD_DIR      | 上传目录                 | ./uploads |

## License

MIT
