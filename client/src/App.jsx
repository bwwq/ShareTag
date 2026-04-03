import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Search, Upload as UploadIcon, User, LogOut, Settings, 
  Heart, Eye, Calendar, MoreVertical, X, Check, Image as ImageIcon,
  LayoutDashboard, ShieldCheck, Users, FolderTree, Sliders, ChevronDown, ChevronLeft, ChevronRight,
  Link as LinkIcon, UploadCloud, Info, Copy, Edit2, Trash2, ArrowRight, ArrowLeft
} from 'lucide-react';

/* ====================================================================
   DEBUG MODE: 临时调试模式。设置为 true 时，将拦截网络请求并填充测试数据
   需要使用真实后端数据时，将 DEBUG_MODE 改为 false 即可一键关闭！
==================================================================== */
const DEBUG_MODE = false;

const MOCK_CATEGORIES = [
  { id: 1, slug: 'character', name: '人物肖像', desc: '精致的人物摄影与插画' },
  { id: 2, slug: 'scene', name: '自然风景', desc: '令人叹为观止的风光' },
  { id: 3, slug: 'cyberpunk', name: '赛博朋克', desc: '未来主义都市风情' },
  { id: 4, slug: 'abstract', name: '抽象艺术', desc: '色彩与形状的碰撞' },
];

const MOCK_TAGS = [
  { name: '1girl', count: 1205 }, { name: 'landscape', count: 840 },
  { name: 'night city', count: 650 }, { name: 'neon', count: 432 },
  { name: 'cinematic lighting', count: 320 }, { name: 'masterpiece', count: 210 },
  { name: 'minimalist', count: 180 }, { name: 'black and white', count: 150 },
];

const MOCK_IMAGES = Array.from({ length: 30 }).map((_, i) => {
  const height = Math.floor(Math.random() * (600 - 300 + 1) + 300);
  return {
    id: i + 1,
    title: `优美艺术作品 ${i + 1}`,
    thumbnail_url: `https://picsum.photos/seed/${i + 1}/400/${height}`,
    image_url: `https://picsum.photos/seed/${i + 1}/1200/${height * 3}`,
    width: 400, height: height, size: 2500000,
    tags: JSON.stringify(['art', i % 2 === 0 ? 'portrait' : 'landscape', 'hd']),
    raw_tags: "art, portrait, hd, masterpiece",
    user_id: i % 3 === 0 ? 2 : 1,
    user: { id: i % 3 === 0 ? 2 : 1, username: i % 3 === 0 ? 'Alice' : 'Admin User', avatar_url: `https://i.pravatar.cc/150?u=${i}` },
    created_at: new Date(Date.now() - Math.random() * 10000000000).toISOString(),
    status: i === 0 ? 'pending' : 'approved',
    views: Math.floor(Math.random() * 10000),
    likes: Math.floor(Math.random() * 1000)
  };
});

// --- API UTILS (With Debug Interceptor) ---
const api = {
  get: async (url) => {
    if (DEBUG_MODE) {
       await new Promise(r => setTimeout(r, 300)); // Simulate network delay
       if (url.includes('/api/auth/me')) return { id: 1, username: 'Admin User', role: 'admin', avatar_url: 'https://i.pravatar.cc/150?u=admin' };
       if (url.includes('/api/auth/providers')) return [{id: 'linuxdo', name: 'LINUX DO'}];
       if (url.includes('/api/tags/popular')) return MOCK_TAGS;
       if (url.includes('/api/tags/search')) return MOCK_TAGS;
       if (url.includes('/api/categories')) return MOCK_CATEGORIES;
       if (url.includes('/api/admin/dashboard')) return { users: 120, images: 30, pendingImages: 5, recentImages: MOCK_IMAGES.slice(0, 5) };
       if (url.includes('/api/admin/images')) return { data: MOCK_IMAGES };
       if (url.includes('/api/admin/users')) return { data: [{id: 1, username: 'Admin User', email: 'admin@local.com', role: 'admin'}, {id: 2, username: 'Alice', email: 'alice@local.com', role: 'user'}] };
       if (url.includes('/api/images')) {
          if (url.includes('limit=')) {
             let res = [...MOCK_IMAGES];
             if (url.includes('sort=popular')) res.sort((a,b) => b.likes - a.likes);
             else res.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
             if (url.includes('q=')) {
                 const searchPattern = decodeURIComponent(url.includes('q=') ? url.split('q=')[1].split('&')[0] : '').toLowerCase();
                 if (searchPattern) res = res.filter(img => img.title.toLowerCase().includes(searchPattern) || img.raw_tags.toLowerCase().includes(searchPattern));
             }
             return { data: res, pagination: { total: res.length } };
          }
          const id = parseInt(url.split('/').pop());
          return MOCK_IMAGES.find(i => i.id === id) || MOCK_IMAGES[0];
       }
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  post: async (url, body, isFormData = false) => {
    if (DEBUG_MODE) {
       await new Promise(r => setTimeout(r, 800));
       if (url.includes('/api/images/extract-tags')) return { extracted_tags: '1girl, solo, masterpiece, best quality, ultra-detailed, cinematic lighting, looking at viewer, depth of field, sharp focus, beautiful detailed eyes, elegant, intricate details, 8k wallpaper' };
       return { success: true };
    }
    const options = { method: 'POST', body: isFormData ? body : JSON.stringify(body) };
    if (!isFormData) options.headers = { 'Content-Type': 'application/json' };
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  put: async (url, body) => {
    if (DEBUG_MODE) return { success: true };
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  delete: async (url) => {
    if (DEBUG_MODE) return { ok: true };
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
};

const formatDate = (dateString) => {
  if (!dateString) return '';
  const options = { year: 'numeric', month: 'short', day: 'numeric' };
  return new Date(dateString).toLocaleDateString('zh-CN', options);
};

// --- CUSTOM PREMIUM COMPONENTS ---
const Button = ({ children, variant = 'primary', className = '', icon: Icon, ...props }) => {
  const baseStyle = "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-all duration-300 rounded-xl active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus:outline-none";
  const variants = {
    primary: "bg-white text-black hover:bg-zinc-200 shadow-[0_0_15px_rgba(255,255,255,0.1)]",
    secondary: "bg-zinc-900 text-zinc-100 border border-white/10 hover:bg-zinc-800 hover:border-white/20 shadow-sm",
    ghost: "text-zinc-400 hover:text-white hover:bg-white/5",
    danger: "bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20",
  };
  return (
    <button className={`${baseStyle} ${variants[variant]} ${className}`} {...props}>
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
};

const DropdownSelect = ({ options, value, onChange, placeholder = "请选择", className = "" }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsOpen(false); };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.value === value);

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button 
        type="button" onClick={() => setIsOpen(!isOpen)} 
        className={`flex items-center justify-between w-full bg-white/10 backdrop-blur-xl rounded-full px-5 py-2.5 text-sm transition-all duration-300 ${isOpen ? 'bg-white/20 text-white shadow-lg' : 'text-zinc-300 hover:bg-white/20'}`}
      >
        <span className="truncate font-medium">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown className={`w-4 h-4 ml-2 transition-transform duration-300 ${isOpen ? 'rotate-180 text-white' : 'text-zinc-400'}`} />
      </button>
      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-zinc-900/80 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-2xl shadow-black overflow-hidden py-1.5 animate-in fade-in slide-in-from-top-2 origin-top">
          {options.map((opt) => (
            <button 
              key={opt.value} onClick={() => { onChange(opt.value); setIsOpen(false); }} 
              className={`w-full text-left px-5 py-2.5 text-sm transition-colors flex items-center justify-between ${value === opt.value ? 'bg-white/10 text-white font-medium' : 'text-zinc-400 hover:bg-white/10 hover:text-white'}`}
            >
              {opt.label}
              {value === opt.value && <Check className="w-4 h-4 text-white" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const TagInput = ({ tags, onChange }) => {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isFocused, setIsFocused] = useState(false);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  const addTag = (tag) => {
    const trimmed = tag.trim().replace(/^,+|,+$/g, '');
    if (trimmed && !tags.includes(trimmed)) onChange([...tags, trimmed]);
    setInputValue('');
    setSuggestions([]);
  };

  const removeTag = (indexToRemove) => onChange(tags.filter((_, idx) => idx !== indexToRemove));

  useEffect(() => {
    if (inputValue.trim()) {
      api.get(`/api/tags/search?q=${encodeURIComponent(inputValue)}`)
         .then(setSuggestions).catch(() => setSuggestions([]));
    } else {
      setSuggestions([]);
    }
  }, [inputValue]);

  return (
    <div className="relative">
      <div className={`flex flex-wrap items-center gap-2 p-2.5 bg-zinc-900/40 backdrop-blur-md border rounded-2xl transition-all duration-300 ${isFocused ? 'border-white/30 bg-zinc-900 shadow-[0_0_20px_rgba(255,255,255,0.05)]' : 'border-white/10 hover:border-white/20'}`}>
        {tags.map((tag, index) => (
          <span key={index} className="flex items-center gap-1.5 px-3 py-1 text-sm font-medium bg-zinc-800 text-zinc-200 border border-white/5 rounded-lg group animate-in fade-in zoom-in duration-200">
            {tag}
            <button type="button" onClick={() => removeTag(index)} className="p-0.5 rounded-md hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"><X className="w-3.5 h-3.5" /></button>
          </span>
        ))}
        <input
          type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)} onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData('text');
            const parts = pasted.split(',').map(t => t.trim()).filter(Boolean);
            const newTags = [...tags];
            parts.forEach(p => { if (!newTags.includes(p)) newTags.push(p); });
            onChange(newTags);
          }}
          placeholder={tags.length === 0 ? "输入标签，回车或逗号分隔..." : "也可直接粘贴整段 Prompt..."}
          className="flex-1 min-w-[150px] bg-transparent border-none focus:outline-none text-sm text-white px-2 py-1 placeholder:text-zinc-600"
        />
      </div>
      {isFocused && suggestions.length > 0 && (
        <div className="absolute z-10 w-full mt-2 bg-zinc-900/95 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-2xl shadow-black overflow-hidden py-1.5 animate-in fade-in slide-in-from-top-2">
          {suggestions.map((s, i) => (
            <div key={i} onClick={() => addTag(s.name)} className="flex items-center justify-between px-5 py-2.5 text-sm cursor-pointer hover:bg-white/10 transition-colors">
              <span className="text-white font-medium">{s.name}</span>
              <span className="text-zinc-500 text-xs font-mono">{s.use_count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const PremiumTag = ({ children, active, onClick, className = "" }) => (
  <button onClick={onClick} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-300 whitespace-nowrap ${active ? 'bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.15)]' : 'bg-zinc-900 border border-white/5 text-zinc-400 hover:bg-zinc-800 hover:text-white hover:border-white/20'} ${className}`}>{children}</button>
);

const PasswordModal = ({ onClose }) => {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!oldPassword || !newPassword || newPassword.length < 6) return setError('缺少原密码，或新密码不足 6 位');
    setLoading(true); setError('');
    try {
      await api.put('/api/auth/local/password', { old_password: oldPassword, new_password: newPassword });
      alert('密码修改成功，请妥善保管！');
      onClose();
    } catch(err) {
      setError('修改请求失败');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-zinc-950 border border-white/10 rounded-3xl w-full max-w-md shadow-2xl relative overflow-hidden animate-in zoom-in-95">
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-zinc-900/50">
          <h3 className="text-xl font-bold text-white flex items-center gap-2"><Settings className="w-5 h-5"/> 安全设置</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors"><X className="w-5 h-5"/></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-5">
          {error && <div className="p-3 bg-red-500/10 text-red-500 text-sm rounded-xl border border-red-500/20">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">原密码</label>
            <input type="password" value={oldPassword} onChange={e=>setOldPassword(e.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30" placeholder="验证您的身份" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">新密码</label>
            <input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30" placeholder="至少 6 位字符" />
          </div>
          <Button type="submit" disabled={loading} className="w-full py-3">
            {loading ? '处理中...' : '确认修改'}
          </Button>
        </form>
      </div>
    </div>
  );
};

const Navbar = ({ navigate, currentPath, user }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  
  const [searchTags, setSearchTags] = useState([]);
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    const qParams = new URLSearchParams(currentPath.split('?')[1] || '');
    const q = qParams.get('q');
    if (q) setSearchTags(q.split(',').map(s => s.trim()).filter(Boolean));
    else setSearchTags([]);
    setSearchInput('');
  }, [currentPath]);

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      let newTags = [...searchTags];
      if (searchInput.trim()) {
        const parts = searchInput.split(',').map(s => s.trim()).filter(Boolean);
        newTags = [...newTags, ...parts];
        setSearchInput('');
      }
      if (newTags.length > 0) navigate(`/?q=${encodeURIComponent(newTags.join(', '))}`);
      else navigate('/');
    } else if (e.key === ',' || e.key === '，') {
      e.preventDefault();
      if (searchInput.trim()) {
        const parts = searchInput.split(/,|，/).map(s => s.trim()).filter(Boolean);
        setSearchTags([...searchTags, ...parts]);
        setSearchInput('');
      }
    } else if (e.key === 'Backspace' && !searchInput && searchTags.length > 0) {
      e.preventDefault();
      const popped = searchTags[searchTags.length - 1];
      setSearchTags(searchTags.slice(0, -1));
      setSearchInput(popped);
    }
  };

  const removeSearchTag = (index) => {
    const newTags = searchTags.filter((_, i) => i !== index);
    if (newTags.length > 0) navigate(`/?q=${encodeURIComponent(newTags.join(', '))}`);
    else navigate('/');
  };

  const [showPwdModal, setShowPwdModal] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${isScrolled ? 'bg-black/70 backdrop-blur-2xl border-b border-white/10 shadow-2xl shadow-black' : 'bg-gradient-to-b from-black/80 to-transparent'}`}>
      <div className="max-w-[1600px] mx-auto px-6 h-20 flex items-center justify-between gap-8">
        <div className="flex items-center gap-3 cursor-pointer group" onClick={() => navigate('/')}>
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center transform group-hover:rotate-[15deg] transition-all duration-500 shadow-[0_0_15px_rgba(255,255,255,0.2)]"><ImageIcon className="w-5 h-5 text-black" /></div>
          <span className="text-xl font-bold text-white tracking-tight">Lumina</span>
        </div>
        <div className="flex-1 max-w-2xl hidden md:block relative group">
          <div className={`flex items-center border border-white/10 hover:border-white/20 transition-all duration-300 rounded-[20px] px-3 py-1.5 ${isScrolled ? 'bg-zinc-900/90 backdrop-blur-2xl' : 'bg-zinc-900/40 backdrop-blur-3xl'} focus-within:bg-zinc-900/80 focus-within:shadow-[0_8px_30px_rgba(0,0,0,0.4)]`}>
            <Search className="w-4 h-4 text-zinc-400 group-focus-within:text-white transition-colors ml-2 shrink-0" />
            <div className="flex-1 flex flex-wrap items-center gap-2 pl-3 pr-1 min-w-0" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
              {searchTags.map((tag, idx) => (
                <span key={idx} className="flex items-center gap-1.5 max-w-[160px] pl-3 pr-1.5 py-[5px] text-[13px] tracking-wide font-medium bg-white/[0.08] text-zinc-100 border border-white/[0.05] shadow-[inset_0_1px_rgba(255,255,255,0.05)] rounded-full transition-all duration-300 hover:bg-white/[0.12] pointer-events-auto cursor-default animate-in fade-in zoom-in duration-200">
                  <span className="truncate leading-none relative top-[0.5px]">{tag}</span>
                  <div className="w-[18px] h-[18px] rounded-full bg-black/20 hover:bg-black/50 flex items-center justify-center transition-colors cursor-pointer shrink-0 text-white/70 hover:text-white" onClick={(e) => { e.stopPropagation(); removeSearchTag(idx); }}>
                     <X className="w-2.5 h-2.5" />
                  </div>
                </span>
              ))}
              <input 
                type="text" placeholder={searchTags.length === 0 ? "搜索优质图片、标签或创作者..." : "继续输入..."} 
                className="flex-1 bg-transparent border-none focus:outline-none text-[14px] text-zinc-200 placeholder:text-zinc-500 min-w-[120px] py-1 px-1 tracking-wide"
                value={searchInput} onChange={(e) => setSearchInput(e.target.value)} onKeyDown={handleSearchKeyDown}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <Button variant="secondary" onClick={() => navigate('/upload')} icon={UploadIcon} className="hidden sm:flex border-none bg-white/5 hover:bg-white/10">上传</Button>
              <div className="relative group cursor-pointer ml-2 h-20 flex items-center">
                <img src={user.avatar_url || `https://ui-avatars.com/api/?name=${user.username}&background=random`} alt="avatar" className="w-10 h-10 rounded-full border border-white/20 object-cover group-hover:border-white/50 transition-colors" />
                <div className="absolute right-0 top-[calc(100%-10px)] pt-2 w-56 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 transform origin-top-right scale-95 group-hover:scale-100 z-50">
                  <div className="bg-zinc-900/95 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black border border-white/10 flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-white/10 flex items-center gap-3">
                      <img src={user.avatar_url || `https://ui-avatars.com/api/?name=${user.username}&background=random`} className="w-10 h-10 rounded-full object-cover" />
                      <div><p className="text-sm font-bold text-white">{user.username}</p><p className="text-xs text-zinc-500">{user.role}</p></div>
                    </div>
                    <div className="p-2 space-y-1">
                      <button onClick={() => navigate(`/user/${user.id}`)} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-zinc-300 hover:bg-white/10 hover:text-white rounded-xl transition-colors"><User className="w-4 h-4"/> 个人主页</button>
                      {(user.role === 'admin' || user.role === 'trusted') && (
                        <button onClick={() => navigate('/admin')} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-zinc-300 hover:bg-white/10 hover:text-white rounded-xl transition-colors"><ShieldCheck className="w-4 h-4"/> 管理后台</button>
                      )}
                      {user.oidc_provider === 'local' && (
                        <button onClick={() => setShowPwdModal(true)} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-zinc-300 hover:bg-white/10 hover:text-white rounded-xl transition-colors"><Settings className="w-4 h-4"/> 安全设置</button>
                      )}
                      <button onClick={() => { api.post('/api/auth/logout', {}); window.location.href='/'; }} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-xl transition-colors mt-1"><LogOut className="w-4 h-4"/> 退出登录</button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <Button variant="primary" onClick={() => navigate('/login')}>登录 / 注册</Button>
          )}
        </div>
      </div>
      {showPwdModal && <PasswordModal onClose={() => setShowPwdModal(false)} />}
    </nav>
  );
};

const ImageCard = ({ image, onClick }) => {
  const parsedTags = Array.isArray(image.tags) ? image.tags.map(t => typeof t === 'string' ? t : t.name) : (typeof image.tags === 'string' ? (() => { try { return JSON.parse(image.tags); } catch { return image.tags.split(',').map(t => t.trim()).filter(Boolean); } })() : []);
  return (
  <div className="group relative mb-6 break-inside-avoid cursor-pointer overflow-hidden rounded-3xl bg-zinc-900 border border-white/5 shadow-xl shadow-black/50" onClick={() => onClick(image.id)}>
    <img src={image.thumbnail_url || image.image_url} alt={image.title} loading="lazy" className="w-full h-auto object-cover transform group-hover:scale-110 transition-transform duration-1000 ease-out" />
    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
      <div className="absolute top-4 left-4 flex gap-2">
        {parsedTags.slice(0, 2).map((tag, i) => (
          <span key={i} className="px-3 py-1.5 text-xs font-medium text-white bg-black/40 backdrop-blur-md rounded-full border border-white/10">{tag}</span>
        ))}
      </div>
      <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={image.user?.avatar_url || `https://ui-avatars.com/api/?name=${image.user?.username}&background=random`} className="w-8 h-8 rounded-full border border-white/20" />
          <span className="text-sm font-medium text-white shadow-black drop-shadow-lg">{image.user?.username || '未知'}</span>
        </div>
        <div className="flex items-center gap-3 text-zinc-300">
          <span className="flex items-center gap-1.5 text-xs font-medium"><Heart className="w-4 h-4 text-white hover:text-red-500 transition-colors"/> {image.likes || 0}</span>
        </div>
      </div>
    </div>
  </div>
);
}

// --- VIEWS ---

const HomeView = ({ navigate, searchQuery }) => {
  const [images, setImages] = useState([]);
  const [categories, setCategories] = useState([]);
  const [popularTags, setPopularTags] = useState([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [sortOrder, setSortOrder] = useState('latest');
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(Math.ceil(scrollLeft + clientWidth) < scrollWidth);
    }
  }, []);

  useEffect(() => {
    api.get('/api/tags/popular').then(setPopularTags).catch(() => {});
    api.get('/api/categories').then(data => { setCategories(data); setTimeout(checkScroll, 100); }).catch(() => {});
  }, [checkScroll]);

  useEffect(() => {
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [checkScroll]);

  useEffect(() => {
    const fetchImages = async () => {
      let url = '/api/images?limit=50';
      if (activeCategory !== 'all') url += `&category=${activeCategory}`;
      if (searchQuery) url += `&q=${encodeURIComponent(searchQuery)}`;
      if (sortOrder === 'popular') url += `&sort=popular`;
      try {
        const res = await api.get(url);
        setImages(res.data || []);
      } catch (e) {
        console.error(e);
      }
    };
    fetchImages();
  }, [activeCategory, searchQuery, sortOrder]);

  const scroll = (direction) => scrollRef.current?.scrollBy({ left: direction === 'left' ? -300 : 300, behavior: 'smooth' });

  return (
    <div className="max-w-[1600px] mx-auto px-6 pt-28 pb-16">
      <div className="flex flex-col md:flex-row gap-6 justify-between items-center mb-12">
        <div className="relative w-full md:flex-1 min-w-0 group flex items-center">
          <div className={`absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-black via-black/80 to-transparent z-10 flex items-center pointer-events-none transition-opacity duration-300 ${canScrollLeft ? 'opacity-100' : 'opacity-0'}`}>
            <button onClick={() => scroll('left')} className="pointer-events-auto ml-1 w-8 h-8 rounded-full bg-zinc-800/90 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white"><ChevronLeft className="w-5 h-5" /></button>
          </div>
          <div ref={scrollRef} onScroll={checkScroll} className="overflow-x-auto no-scrollbar w-full">
            <div className="inline-flex items-center gap-1 p-1.5 bg-zinc-900/60 backdrop-blur-3xl border border-white/10 rounded-full shadow-2xl min-w-max">
              <button onClick={() => setActiveCategory('all')} className={`shrink-0 px-7 py-2.5 rounded-full text-sm font-bold transition-all ${activeCategory === 'all' ? 'bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.15)] scale-100' : 'text-zinc-400 hover:text-white hover:bg-white/10 scale-95'}`}>全部推荐</button>
              {categories.map(c => (
                <button key={c.slug} onClick={() => setActiveCategory(c.slug)} className={`shrink-0 px-7 py-2.5 rounded-full text-sm font-bold transition-all ${activeCategory === c.slug ? 'bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.15)] scale-100' : 'text-zinc-400 hover:text-white hover:bg-white/10 scale-95'}`}>{c.name}</button>
              ))}
            </div>
          </div>
          <div className={`absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-black via-black/80 to-transparent z-10 flex items-center justify-end pointer-events-none transition-opacity duration-300 ${canScrollRight ? 'opacity-100' : 'opacity-0'}`}>
            <button onClick={() => scroll('right')} className="pointer-events-auto mr-1 w-8 h-8 rounded-full bg-zinc-800/90 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white"><ChevronRight className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="w-full md:w-48 shrink-0 z-40">
          <DropdownSelect options={[{ value: 'latest', label: '最新发布' }, { value: 'popular', label: '最多喜欢' }]} value={sortOrder} onChange={setSortOrder} />
        </div>
      </div>

      <div className="flex flex-col gap-14">
        {images.length === 0 ? (
           <div className="py-20 text-center text-zinc-500 w-full animate-in fade-in">暂无作品，去上传第一张吧</div>
        ) : (
          <div className="w-full columns-1 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5 gap-6">
            {images.map((img) => <ImageCard key={img.id} image={img} onClick={(id) => navigate(`/image/${id}`)} />)}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 border-t border-white/10 pt-14">
          <div className="lg:col-span-2 bg-zinc-900/40 backdrop-blur-2xl p-8 rounded-[2rem] border border-white/5 shadow-xl flex flex-col justify-center">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-6 px-1">实时热门搜索</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
              {popularTags.slice(0, 8).map((tag, i) => (
                <div key={i} onClick={() => navigate(`/?q=${encodeURIComponent(tag.name)}`)} className="flex items-center justify-between group cursor-pointer p-4 rounded-2xl hover:bg-white/5 transition-all duration-300">
                  <div className="flex items-center gap-4">
                    <span className={`font-mono text-sm w-4 text-center ${i < 3 ? 'text-white font-bold' : 'text-zinc-600'}`}>{i + 1}</span>
                    <span className={`text-base font-medium ${i < 3 ? 'text-zinc-200' : 'text-zinc-400'} group-hover:text-white`}>{tag.name}</span>
                  </div>
                  <span className="text-xs text-zinc-600 font-mono bg-zinc-950/50 px-3 py-1.5 rounded-lg border border-white/5">{tag.use_count} 次查询</span>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-1 bg-gradient-to-br from-zinc-800 to-black p-10 rounded-[2rem] border border-white/10 text-white relative overflow-hidden group shadow-2xl flex flex-col justify-center">
            <div className="relative z-10 transition-transform duration-500 group-hover:-translate-y-2">
              <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mb-6 border border-white/10 group-hover:bg-white/20 transition-colors"><UploadCloud className="w-7 h-7 text-white" /></div>
              <h3 className="text-2xl font-bold mb-4 tracking-wide">展示你的创作</h3>
              <p className="text-sm text-zinc-400 mb-8 leading-relaxed">将你引以为傲的作品分享给全球的创作者。AI 会自动为你提取标签并建立索引。</p>
              <Button onClick={() => navigate('/upload')} className="w-full bg-white text-black hover:bg-zinc-200 py-3.5 rounded-xl shadow-[0_0_20px_rgba(255,255,255,0.2)]">立即上传作品</Button>
            </div>
            <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-white/5 rounded-full blur-[80px] group-hover:scale-150 group-hover:bg-white/10 transition-all duration-700"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ImageDetailView = ({ imageId, navigate, user }) => {
  const [image, setImage] = useState(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  useEffect(() => {
    api.get(`/api/images/${imageId}`).then(data => {
      setImage(data);
      setBookmarked(!!data.bookmarked);
    }).catch(() => navigate('/'));
  }, [imageId, navigate]);

  // 删除确认自动重置
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  if (!image) return <div className="pt-32 text-center text-zinc-500 animate-pulse">加载作品边界中...</div>;

  const tagsList = Array.isArray(image.tags) ? image.tags.map(t => typeof t === 'string' ? t : t.name) : (typeof image.tags === 'string' ? (() => { try { return JSON.parse(image.tags); } catch { return image.tags.split(',').map(t => t.trim()).filter(Boolean); } })() : []);
  const isAdmin = user && (user.role === 'admin' || user.role === 'trusted');
  const isOwner = user && image.user_id === user.id;
  const canEdit = isAdmin || isOwner;

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    await api.delete(`/api/images/${imageId}`);
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-black pt-20 animate-in fade-in">
      <div className="max-w-[1800px] mx-auto flex flex-col lg:flex-row h-full">
        <div className={`flex-1 p-4 lg:p-10 flex items-center justify-center bg-zinc-950/50 min-h-[60vh] lg:min-h-[calc(100vh-5rem)] relative transition-all ${isZoomed ? 'fixed inset-0 z-[60] bg-black p-0' : ''}`}>
          {!isZoomed && <button onClick={() => window.history.back()} className="absolute top-4 left-4 lg:top-8 lg:left-8 w-12 h-12 bg-black/40 backdrop-blur-xl border border-white/10 rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-all z-10"><ArrowLeft className="w-5 h-5" /></button>}
          {isZoomed && <button onClick={() => setIsZoomed(false)} className="absolute top-8 right-8 p-3 bg-white/10 backdrop-blur-md text-white rounded-full z-10"><X className="w-6 h-6" /></button>}
          <img src={image.image_url} alt={image.title} className={`object-contain max-w-full max-h-full transition-all duration-500 cursor-zoom-in ${isZoomed ? 'w-full h-full cursor-zoom-out' : 'rounded-3xl shadow-2xl shadow-black border border-white/5'}`} onClick={() => setIsZoomed(!isZoomed)} />
        </div>
        <div className={`w-full lg:w-[450px] bg-zinc-950 border-l border-white/10 p-8 lg:p-12 flex flex-col h-[calc(100vh-5rem)] lg:sticky lg:top-20 overflow-y-auto ${isZoomed ? 'hidden' : ''} custom-scrollbar`}>
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4 cursor-pointer group" onClick={() => navigate(`/user/${image.user_id}`)}>
              <img src={image.user?.avatar_url || `https://ui-avatars.com/api/?name=${image.user?.username}&background=random`} className="w-12 h-12 rounded-full object-cover border border-white/20 group-hover:border-white transition-all" />
              <div><p className="text-base font-bold text-white mb-0.5">{image.user?.username || '未知'}</p><p className="text-xs text-zinc-500">{formatDate(image.created_at)}</p></div>
            </div>
            {canEdit && <button onClick={() => navigate(`/upload?edit=${imageId}`)} className="p-2 text-zinc-500 hover:text-white transition-colors rounded-lg hover:bg-white/5"><Edit2 className="w-4 h-4" /></button>}
          </div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">{image.title || '未命名作品'}</h1>
          {image.description && <p className="text-sm text-zinc-400 mb-6 leading-relaxed">{image.description}</p>}
          {!image.description && <div className="mb-4" />}

          <div className="flex gap-4 mb-10">
            <Button variant={image.liked ? 'secondary' : 'primary'} className={`flex-1 py-3.5 text-base rounded-2xl transition-all ${image.liked ? 'bg-pink-500/20 border-pink-500/30 text-pink-400' : ''}`} icon={Heart} onClick={() => {
              if (image.liked) return;
              api.post(`/api/images/${imageId}/like`, {}).then((res) => {
                if (!res.already_liked) setImage({...image, likes: (image.likes || 0) + 1, liked: true});
                else setImage({...image, liked: true});
              });
            }}>{image.liked ? '已喜欢' : '喜欢'} ({image.likes || 0})</Button>
            <Button variant="secondary" className={`flex-1 py-3.5 text-base rounded-2xl transition-all ${bookmarked ? 'bg-amber-500/20 border-amber-500/30 text-amber-400' : 'bg-zinc-900 border-white/10'}`} icon={FolderTree} onClick={() => {
              const next = !bookmarked;
              setBookmarked(next);
              (next ? api.post(`/api/images/${imageId}/bookmark`, {}) : api.delete(`/api/images/${imageId}/bookmark`)).catch(() => setBookmarked(!next));
            }}>{bookmarked ? '已收藏' : '收藏'}</Button>
            {canEdit && (
              <Button variant="ghost" onClick={handleDelete} className={`flex-[0.2] py-3.5 text-base rounded-2xl px-0 transition-all ${confirmDelete ? 'bg-red-600 text-white border-red-600 animate-pulse' : 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20'}`} icon={Trash2}>{confirmDelete ? '?' : ''}</Button>
            )}
          </div>
          <div className="space-y-8">
            <div>
              {image.prompt_text && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold text-zinc-500 hover:text-white transition-colors cursor-pointer uppercase tracking-widest flex items-center gap-2" onClick={(e) => { e.currentTarget.parentElement.nextElementSibling.classList.toggle('hidden'); }}>
                      ▶ 原始 Prompt
                    </h3>
                    <button className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5" onClick={() => navigator.clipboard.writeText(image.prompt_text)}><Copy className="w-3.5 h-3.5"/> 复制</button>
                  </div>
                  <div className="hidden bg-black/60 border border-white/5 rounded-2xl p-4">
                    <p className="text-sm text-zinc-300 font-mono break-all whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">{image.prompt_text}</p>
                  </div>
                </div>
              )}
              {image.negative_prompt_text && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold text-zinc-500 hover:text-white transition-colors cursor-pointer uppercase tracking-widest flex items-center gap-2" onClick={(e) => { e.currentTarget.parentElement.nextElementSibling.classList.toggle('hidden'); }}>
                      ▶ Negative Prompt
                    </h3>
                    <button className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5" onClick={() => navigator.clipboard.writeText(image.negative_prompt_text)}><Copy className="w-3.5 h-3.5"/> 复制</button>
                  </div>
                  <div className="hidden bg-black/60 border border-white/5 rounded-2xl p-4">
                    <p className="text-sm text-zinc-300 font-mono break-all whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">{image.negative_prompt_text}</p>
                  </div>
                </div>
              )}
            </div>
            <div>
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">图片信息</h3>
              <ul className="space-y-4 text-sm text-zinc-300 bg-zinc-900/50 border border-white/5 rounded-3xl p-6">
                <li className="flex justify-between"><span className="text-zinc-500">分辨率</span><span className="font-mono bg-black px-2 py-1 rounded-md">{image.width} × {image.height}</span></li>
                <li className="flex justify-between"><span className="text-zinc-500">文件大小</span><span className="font-mono bg-black px-2 py-1 rounded-md">{((image.file_size || 0) / 1024 / 1024).toFixed(2)} MB</span></li>
                <li className="flex justify-between"><span className="text-zinc-500">浏览量</span><span className="font-mono bg-black px-2 py-1 rounded-md">{image.views || 0}</span></li>
              </ul>
            </div>
            <div>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">提取标签 ({tagsList.length})</h3>
                <button className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 transition-colors" onClick={() => navigator.clipboard.writeText(tagsList.join(', '))}><Copy className="w-3.5 h-3.5"/> 复制</button>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {tagsList.map((tag, i) => <PremiumTag key={i} active={false} onClick={() => navigate(`/?q=${encodeURIComponent(tag)}`)}>{tag}</PremiumTag>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const UserView = ({ userId, navigate, user: currentUser }) => {
  const [profile, setProfile] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [activeTab, setActiveTab] = useState('uploads');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAvatar, setEditAvatar] = useState('');

  useEffect(() => {
    api.get(`/api/auth/users/${userId}`).then(res => {
      setProfile(res.user);
      setUploads(res.uploads || []);
      setBookmarks(res.bookmarks || []);
      setEditName(res.user.username);
      setEditAvatar(res.user.avatar_url || '');
    }).catch(() => {});
  }, [userId]);

  const isSelf = currentUser && currentUser.id === parseInt(userId);
  const canEdit = isSelf && currentUser.role === 'admin';

  const handleSaveProfile = async () => {
    try {
      const updated = await api.put('/api/auth/profile', { username: editName, avatar_url: editAvatar || null });
      setProfile(updated);
      setEditing(false);
    } catch (e) { alert('保存失败: ' + (e.error || e.message)); }
  };

  if (!profile) return <div className="pt-32 text-center text-zinc-500 animate-pulse">加载用户信息中...</div>;

  const displayImages = activeTab === 'uploads' ? uploads : bookmarks;
  const avatarSrc = profile.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.username)}&background=random`;

  return (
    <div className="min-h-screen bg-black pt-20 animate-in fade-in">
       <div className="w-full h-64 md:h-80 relative">
          <button onClick={() => window.history.back()} className="absolute top-8 left-8 z-10 w-12 h-12 bg-black/40 backdrop-blur-xl border border-white/10 rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-all shadow-xl"><ArrowLeft className="w-5 h-5" /></button>
          <img src={`https://picsum.photos/seed/cover${userId}/1600/400`} className="w-full h-full object-cover opacity-60" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
       </div>
       <div className="max-w-[1600px] mx-auto px-6 relative -mt-24">
          <div className="flex flex-col md:flex-row items-center md:items-end gap-6 mb-12">
             <img src={avatarSrc} className="w-32 h-32 md:w-40 md:h-40 rounded-[2rem] border-4 border-black object-cover shadow-2xl" />
             <div className="flex-1 text-center md:text-left mb-2 md:mb-4">
                {editing ? (
                  <div className="space-y-3 max-w-md">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">用户名</label>
                      <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">头像 URL（留空使用默认）</label>
                      <input type="text" value={editAvatar} onChange={e => setEditAvatar(e.target.value)} placeholder="https://..." className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm" />
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={handleSaveProfile} className="px-6 py-2 text-sm rounded-xl">保存</Button>
                      <Button variant="secondary" onClick={() => { setEditing(false); setEditName(profile.username); setEditAvatar(profile.avatar_url || ''); }} className="px-4 py-2 text-sm rounded-xl">取消</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <h1 className="text-4xl md:text-5xl font-bold text-white mb-3">{profile.username}</h1>
                      {canEdit && <button onClick={() => setEditing(true)} className="mb-2 p-2 text-zinc-500 hover:text-white transition-colors"><Edit2 className="w-4 h-4" /></button>}
                    </div>
                    <p className="text-zinc-400 text-sm flex gap-6">
                      <span><strong className="text-white text-lg">{uploads.length}</strong> 作品</span>
                      <span><strong className="text-white text-lg">{bookmarks.length}</strong> 收藏</span>
                      <span className="text-zinc-600">加入于 {formatDate(profile.created_at)}</span>
                    </p>
                  </>
                )}
             </div>
          </div>
          <div className="flex gap-8 border-b border-white/10 mb-8 px-2">
             <button onClick={() => setActiveTab('uploads')} className={`pb-4 text-sm font-bold transition-colors ${activeTab === 'uploads' ? 'text-white border-b-2 border-white' : 'text-zinc-500 hover:text-white'}`}>作品 ({uploads.length})</button>
             <button onClick={() => setActiveTab('bookmarks')} className={`pb-4 text-sm font-bold transition-colors ${activeTab === 'bookmarks' ? 'text-white border-b-2 border-white' : 'text-zinc-500 hover:text-white'}`}>收藏 ({bookmarks.length})</button>
          </div>
          {displayImages.length === 0 ? (
            <div className="py-20 text-center text-zinc-600">{activeTab === 'uploads' ? '暂无作品' : '暂无收藏'}</div>
          ) : (
            <div className="columns-1 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5 gap-6 pb-20">
              {displayImages.map(img => <ImageCard key={img.id} image={img} onClick={(id) => navigate(`/image/${id}`)} />)}
            </div>
          )}
       </div>
    </div>
  );
};

const UploadView = ({ navigate, user, editId }) => {
  const isEditMode = !!editId;
  const [uploadMode, setUploadMode] = useState('local'); 
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState([]);
  const [negativeTags, setNegativeTags] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [preview, setPreview] = useState(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const [promptText, setPromptText] = useState('');
  const [negativeText, setNegativeText] = useState('');
  const [isNsfw, setIsNsfw] = useState(true);

  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatSlug, setNewCatSlug] = useState('');

  const canAddCategory = user && (user.role === 'admin' || user.role === 'trusted');

  useEffect(() => {
    api.get('/api/categories').then(d => { setCategories(d || []); if(!isEditMode && d[0]) setSelectedCategory(d[0].slug); }).catch(()=>{});
  }, []);

  // 编辑模式：加载已有数据
  useEffect(() => {
    if (!isEditMode) return;
    api.get(`/api/images/${editId}`).then(data => {
      setTitle(data.title || '');
      setDescription(data.description || '');
      setPreview(data.image_url);
      setPromptText(data.prompt_text || '');
      setNegativeText(data.negative_prompt_text || '');
      setIsNsfw(data.is_nsfw !== 0);
      // 填充标签
      const tagsList = Array.isArray(data.tags) ? data.tags.map(t => typeof t === 'string' ? t : t.name) : [];
      setTags(tagsList);
      // 分类
      if (data.tags?.length > 0 && data.tags[0]?.category) {
        setSelectedCategory(data.tags[0].category);
      }
    }).catch(() => navigate('/'));
  }, [editId]);

  const handleAddCategory = async () => {
    if (!newCatName || !newCatSlug) return;
    try {
      const res = await api.post('/api/categories', { name: newCatName, slug: newCatSlug });
      setCategories([...categories, res]);
      setSelectedCategory(res.slug);
      setIsAddingCategory(false);
      setNewCatName('');
      setNewCatSlug('');
    } catch (e) {
      alert('添加分类失败: ' + (e.error || e.message));
    }
  };

  const handleFile = async (selectedFile) => {
    setFile(selectedFile);
    setPreview(URL.createObjectURL(selectedFile));
    setIsExtracting(true);
    try {
      const fd = new FormData(); fd.append('file', selectedFile);
      const res = await api.post('/api/images/extract-tags', fd, true);
      if (res.extracted_tags) setTags(res.extracted_tags.split(',').map(t=>t.trim()).filter(Boolean));
      if (res.extracted_negative_tags) setNegativeTags(res.extracted_negative_tags.split(',').map(t=>t.trim()).filter(Boolean));
      if (res.prompt_text) setPromptText(res.prompt_text);
      if (res.negative_prompt_text) setNegativeText(res.negative_prompt_text);
    } catch (e) {
      console.error('Extract err', e);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDrop = (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); };
  
  const submit = async () => {
    setIsUploading(true);
    try {
      if (isEditMode) {
        // 编辑模式：PUT 更新
        await api.put(`/api/images/${editId}`, {
          title: title || null,
          description: description || null,
          tags: tags.join(', '),
          category_slug: selectedCategory || null,
          is_nsfw: isNsfw,
        });
        navigate(`/image/${editId}`);
      } else {
        // 新建模式：POST 上传
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        if(title) fd.append('title', title);
        if(selectedCategory) fd.append('category_slug', selectedCategory);
        fd.append('tags', tags.join(', '));
        if (promptText) fd.append('prompt_text', promptText);
        if (negativeText) fd.append('negative_prompt_text', negativeText);
        fd.append('is_nsfw', isNsfw ? '1' : '0');
        await api.post('/api/images', fd, true);
        alert('发布成功，请等待审核！');
        navigate('/');
      }
    } catch(e) {
      alert((isEditMode ? '保存' : '发布') + '失败: ' + e.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black pt-28 pb-16 px-6 animate-in fade-in duration-700">
      <div className="max-w-5xl mx-auto">
        <div className="mb-10 flex items-center gap-6">
          <button onClick={() => window.history.back()} className="w-12 h-12 bg-zinc-900 border border-white/10 rounded-full flex items-center justify-center text-white hover:bg-white/10 transition-all shrink-0"><ArrowLeft className="w-5 h-5" /></button>
          <h1 className="text-4xl font-bold text-white tracking-tight">{isEditMode ? '编辑作品' : '发布作品'}</h1>
        </div>
        <div className="bg-zinc-950 rounded-[2rem] border border-white/10 shadow-2xl overflow-hidden flex flex-col md:flex-row min-h-[600px]">
          <div className="w-full md:w-1/2 p-8 md:p-10 bg-zinc-900/30 flex flex-col relative" onDragOver={e=>e.preventDefault()} onDrop={handleDrop}>
            {preview ? (
              <div className="relative flex-1 rounded-3xl overflow-hidden group bg-black">
                <img src={preview} alt="Preview" className="w-full h-full object-contain" />
                {!isEditMode && <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex justify-center items-center transition-all"><Button variant="secondary" onClick={()=>{setPreview(null);setFile(null);}}>重新选择</Button></div>}
              </div>
            ) : (
              <div className="flex-1 border-2 border-dashed border-white/20 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:bg-white/5 transition-colors" onClick={() => document.getElementById('file-up').click()}>
                <UploadCloud className="w-10 h-10 text-white mb-4" />
                <h3 className="text-white font-bold mb-2">点击或拖拽文件至此</h3>
                <p className="text-sm text-zinc-500">支持 PNG, JPG, WEBP。AI 将自动分析提取 Tag</p>
                <input type="file" id="file-up" className="hidden" accept="image/*" onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])} />
              </div>
            )}
          </div>
          <div className="w-full md:w-1/2 p-8 md:p-10 flex flex-col gap-8">
            <div>
              <label className="block text-sm font-bold text-zinc-300 mb-3">作品标题</label>
              <input type="text" value={title} onChange={e=>setTitle(e.target.value)} placeholder="不填则使用原文件名" className="w-full bg-zinc-900 border border-white/10 rounded-xl px-5 py-3.5 text-sm text-white" />
            </div>
            {isEditMode && (
              <div>
                <label className="block text-sm font-bold text-zinc-300 mb-3">作品描述</label>
                <textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="添加作品描述..." className="w-full h-20 bg-zinc-900 border border-white/10 rounded-xl px-5 py-3.5 text-sm text-white resize-none" />
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-bold text-zinc-300">分类归属</label>
                {canAddCategory && !isAddingCategory && (
                  <button onClick={() => setIsAddingCategory(true)} className="text-xs text-blue-400 hover:text-blue-300 border border-blue-500/20 px-2 py-1 rounded bg-blue-500/10 transition-colors">+ 新增分类</button>
                )}
              </div>
              
              {isAddingCategory ? (
                <div className="space-y-3 bg-zinc-900 border border-white/10 rounded-xl p-4 mb-4">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">外显名称</label>
                    <input type="text" value={newCatName} onChange={e=>setNewCatName(e.target.value)} placeholder="如：NovelAI" className="w-full bg-zinc-950 border border-white/5 rounded-lg px-3 py-2 text-sm text-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">内部路由 (Slug，必须为英文字符或短划线)</label>
                    <input type="text" value={newCatSlug} onChange={e=>setNewCatSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="如：nai" className="w-full bg-zinc-950 border border-white/5 rounded-lg px-3 py-2 text-sm text-white" />
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button onClick={() => setIsAddingCategory(false)} className="text-xs text-zinc-400 hover:text-white px-3 py-1.5">取消</button>
                    <button onClick={handleAddCategory} disabled={!newCatName || !newCatSlug} className="text-xs bg-white text-black font-bold px-4 py-1.5 rounded-lg disabled:opacity-50">保存分类</button>
                  </div>
                </div>
              ) : (
                <DropdownSelect options={categories.map(c=>({value:c.slug, label:c.name}))} value={selectedCategory} onChange={setSelectedCategory} placeholder="请选择或尝试新建"/>
              )}
            </div>
            <div>
              <label className="block text-sm font-bold text-zinc-300 mb-3">内容分级</label>
              <div className="flex gap-3">
                <button type="button" onClick={() => setIsNsfw(true)} className={`flex-1 py-3 rounded-xl text-sm font-bold border transition-all ${isNsfw ? 'bg-red-500/20 border-red-500/40 text-red-400' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-white hover:bg-zinc-800'}`}>NSFW</button>
                <button type="button" onClick={() => setIsNsfw(false)} className={`flex-1 py-3 rounded-xl text-sm font-bold border transition-all ${!isNsfw ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-white hover:bg-zinc-800'}`}>SFW（全年龄）</button>
              </div>
              <p className="text-[10px] text-zinc-500 mt-1.5">默认为 NSFW，未登录用户将无法查看 NSFW 内容</p>
            </div>
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-bold">{isEditMode ? '标签（可直接编辑）' : '正向提示词 (Prompt)'}</label>
                  {isExtracting && <span className="text-xs text-blue-400 animate-pulse">AI 分析中...</span>}
                </div>
                {isEditMode ? (
                  <div className="pt-1">
                    <TagInput tags={tags} onChange={setTags} />
                  </div>
                ) : (
                  <>
                    <textarea value={promptText} onChange={e=>setPromptText(e.target.value)} placeholder="拖拽图片后将自动在此填入正向提示词..." className="w-full h-24 bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-xs text-zinc-300 font-mono resize-none focus:ring-1 focus:ring-white/10 focus:outline-none custom-scrollbar" />
                    <details className="mt-2 group">
                      <summary className="text-xs font-bold text-zinc-500 cursor-pointer hover:text-white transition-colors list-none flex items-center gap-1.5 marker:hidden select-none outline-none">
                         <span className="group-open:rotate-90 transition-transform">▶</span> 识别标签结果 (折叠)
                      </summary>
                      <div className="pt-3">
                        <TagInput tags={tags} onChange={setTags} />
                      </div>
                    </details>
                  </>
                )}
              </div>

              {!isEditMode && (
                <div>
                  <label className="block text-sm font-bold mb-2">反向提示词 (Negative Prompt)</label>
                  <textarea value={negativeText} onChange={e=>setNegativeText(e.target.value)} placeholder="拖拽图片后将自动在此填入反向提示词..." className="w-full h-24 bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-xs text-zinc-300 font-mono resize-none focus:ring-1 focus:ring-white/10 focus:outline-none custom-scrollbar" />
                  <details className="mt-2 group">
                    <summary className="text-xs font-bold text-zinc-500 cursor-pointer hover:text-white transition-colors list-none flex items-center gap-1.5 marker:hidden select-none outline-none">
                       <span className="group-open:rotate-90 transition-transform">▶</span> 负向识别结果 (折叠)
                    </summary>
                    <div className="pt-3">
                      <TagInput tags={negativeTags} onChange={setNegativeTags} />
                    </div>
                  </details>
                </div>
              )}
            </div>
            
            <div className="mt-auto pt-6">
              <Button onClick={submit} disabled={(!isEditMode && !file) || isUploading || isExtracting} className="w-full py-4 text-base font-bold rounded-2xl">{isUploading ? '处理中...' : (isEditMode ? '保存修改' : '确认发布作品')}</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const LoginView = () => {
  const [providers, setProviders] = useState([]);
  const [mode, setMode] = useState('sso'); // 'sso', 'login', 'register'
  const [isSetup, setIsSetup] = useState(false);
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { 
    api.get('/api/auth/providers').then(setProviders).catch(()=>{});
    api.get('/api/auth/status').then(res => {
      if (res.needsSetup) { setIsSetup(true); setMode('register'); }
    }).catch(()=>{});
  }, []);

  const handleLocalSubmit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      if (!form.username || !form.password) throw new Error('需填写所有字段');
      const point = mode === 'login' ? '/api/auth/local/login' : '/api/auth/local/register';
      await api.post(point, form);
      window.location.href = '/';
    } catch (err) {
      setError(err.error || err.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-zinc-900 via-black to-black animate-in fade-in">
      <div className="w-full max-w-[420px] bg-zinc-950/80 backdrop-blur-2xl rounded-[2.5rem] p-10 shadow-2xl border border-white/10 text-center relative overflow-hidden">
        {mode !== 'sso' && !isSetup && (
          <button onClick={() => {setMode('sso'); setError('');}} className="absolute top-6 left-6 text-zinc-500 hover:text-white transition-colors"><ArrowLeft className="w-5 h-5"/></button>
        )}
        <div className="w-20 h-20 bg-white rounded-3xl mx-auto flex items-center justify-center mb-8 transform rotate-6 drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]"><ImageIcon className="w-10 h-10 text-black" /></div>
        <h1 className="text-3xl font-bold text-white mb-3">{isSetup ? '初始化系统' : (mode === 'sso' ? '进入 Lumina' : (mode === 'login' ? '账号登录' : '注册账号'))}</h1>
        <p className="text-zinc-400 mb-8 text-sm">{isSetup ? '创建全站首个管理员账号' : '连接全球顶级创作者的视觉社区。'}</p>
        
        {error && <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm animate-in zoom-in">{error}</div>}

        {mode === 'sso' ? (
          <div className="space-y-4">
            {providers.length > 0 ? providers.map(p => (
              <a key={p.name} href={p.login_url} className="w-full flex justify-center py-3.5 bg-zinc-900 border border-white/10 hover:bg-zinc-800 text-white font-medium rounded-2xl transition-all">
                通过 {p.display_name} 登录
              </a>
            )) : <p className="text-red-400 text-sm py-2">无第三方登录选项</p>}
            
            <div className="pt-6 border-t border-white/5">
              <button onClick={() => setMode('login')} className="w-full py-3.5 bg-transparent border border-white/10 hover:bg-white/5 text-zinc-300 font-medium rounded-2xl transition-all">
                使用本地账号密码登录
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleLocalSubmit} className="space-y-4 text-left">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2 px-1">用户名</label>
              <input type="text" value={form.username} onChange={e=>setForm({...form, username: e.target.value})} className="w-full bg-zinc-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30 focus:shadow-[0_0_15px_rgba(255,255,255,0.1)] transition-all" placeholder="输入用户名" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2 px-1">密码</label>
              <input type="password" value={form.password} onChange={e=>setForm({...form, password: e.target.value})} className="w-full bg-zinc-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30 focus:shadow-[0_0_15px_rgba(255,255,255,0.1)] transition-all" placeholder="输入超6位密码" />
            </div>
            <Button type="submit" disabled={loading} className="w-full mt-4 py-3.5 rounded-xl block">{loading ? '处理中...' : (mode === 'login' ? '登录' : '创建账号')}</Button>
            {!isSetup && (
              <p className="text-center text-sm text-zinc-500 mt-6">
                {mode === 'login' ? '还没有账号？' : '已有账号？'} 
                <span onClick={() => {setMode(mode === 'login' ? 'register' : 'login'); setError('');}} className="text-white font-medium cursor-pointer ml-2 hover:underline">{mode === 'login' ? '立即注册' : '去登录'}</span>
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
};

// --- ADMIN VIEWS ---
const AdminLayout = ({ children, currentPath, navigate }) => {
  const menus = [
    { id: '/admin', label: '数据仪表盘', icon: LayoutDashboard }, 
    { id: '/admin/images', label: '内容审核', icon: ShieldCheck }, 
    { id: '/admin/users', label: '用户管理', icon: Users },
    { id: '/admin/oidc', label: '配置(OIDC)', icon: LinkIcon }
  ];
  return (
    <div className="flex h-screen bg-black selection:bg-white/20">
      <div className="w-72 bg-zinc-950 border-r border-white/5 flex flex-col z-10">
        <div className="h-20 flex items-center px-8 cursor-pointer group" onClick={()=>navigate('/')}>
          <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mr-3 group-hover:bg-white/10 transition-colors"><ArrowLeft className="w-4 h-4 text-zinc-400 group-hover:text-white" /></div>
          <span className="font-bold text-lg text-white">Admin Console</span>
        </div>
        <div className="flex-1 p-4 space-y-1.5">{menus.map(m => <button key={m.id} onClick={()=>navigate(m.id)} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-medium ${currentPath===m.id?'bg-white text-black':'text-zinc-400 hover:text-white hover:bg-zinc-900'}`}><m.icon className="w-4 h-4"/>{m.label}</button>)}</div>
      </div>
      <div className="flex-1 overflow-y-auto p-10">{children}</div>
    </div>
  );
};

const AdminDashboard = () => {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/api/admin/dashboard').then(setData).catch(()=>{}); }, []);
  if (!data) return <div className="text-zinc-500 animate-pulse">Loading Dashboard...</div>;
  const { stats, recent_uploads } = data;
  return (
    <div className="animate-in fade-in">
      <h1 className="text-3xl font-bold mb-10">数据概览</h1>
      <div className="grid grid-cols-4 gap-6 mb-10">
        <div className="bg-zinc-900/50 p-6 rounded-3xl border border-white/5"><div className="text-zinc-400 mb-4">总用户</div><div className="text-3xl font-bold text-white">{stats.total_users}</div></div>
        <div className="bg-zinc-900/50 p-6 rounded-3xl border border-white/5"><div className="text-zinc-400 mb-4">总作品</div><div className="text-3xl font-bold text-white">{stats.total_images}</div></div>
        <div className="bg-zinc-900/50 p-6 rounded-3xl border border-white/5"><div className="text-zinc-400 mb-4">已通过</div><div className="text-3xl font-bold text-emerald-400">{stats.approved_images}</div></div>
        <div className="bg-zinc-900/50 p-6 rounded-3xl border border-red-500/20"><div className="text-zinc-400 mb-4">待审核</div><div className="text-3xl font-bold text-red-500">{stats.pending_images}</div></div>
      </div>
      <h3 className="font-bold mb-4">最新上传</h3>
      <div className="bg-zinc-950 rounded-[2rem] border border-white/5 overflow-hidden">
        <table className="w-full text-left text-sm text-zinc-300">
          <thead className="bg-zinc-900/50"><tr><th className="p-4">图</th><th className="p-4">用户</th><th className="p-4">状态</th><th className="p-4">时间</th></tr></thead>
          <tbody className="divide-y divide-white/5">{(recent_uploads || []).map(img => <tr key={img.id}>
            <td className="p-4"><img src={img.thumbnail_url} className="w-10 h-10 object-cover rounded" /></td>
            <td className="p-4">{img.user?.username || img.user_id}</td>
            <td className="p-4">{img.status}</td>
            <td className="p-4 text-zinc-500">{new Date(img.created_at).toLocaleString()}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  );
};

const AdminImages = () => {
  const [images, setImages] = useState([]);
  const load = () => api.get('/api/admin/images?limit=50&status=all').then(res => setImages(res.data)).catch(()=>{});
  useEffect(() => { load(); }, []);
  const review = async (id, status) => { await api.put(`/api/admin/images/${id}/review`, { status }); load(); };
  
  return (
    <div className="animate-in fade-in">
      <h1 className="text-3xl font-bold mb-6">内容审核</h1>
      <div className="bg-zinc-950 rounded-[2rem] border border-white/5 overflow-hidden">
        <table className="w-full text-left text-sm text-zinc-300">
          <thead className="bg-zinc-900/50"><tr><th className="p-4">图</th><th className="p-4">状态</th><th className="p-4 text-right">操作</th></tr></thead>
          <tbody className="divide-y divide-white/5">{images.map(img => <tr key={img.id}>
            <td className="p-4 flex gap-4"><img src={img.thumbnail_url} className="w-12 h-12 rounded object-cover" /><span>{img.title}</span></td>
            <td className="p-4">{img.status === 'pending' ? <span className="text-red-400">待审核</span> : <span className="text-emerald-400">已通过</span>}</td>
            <td className="p-4 text-right">
              <div className="flex items-center justify-end gap-2">
                {img.status === 'pending' && <Button variant="ghost" onClick={() => review(img.id, 'approved')} className="text-emerald-400 font-medium text-xs px-3 py-1.5 h-auto">通过</Button>}
                {img.status !== 'rejected' && <Button variant="ghost" onClick={() => review(img.id, 'rejected')} className="text-orange-400 font-medium text-xs px-3 py-1.5 h-auto">拒绝</Button>}
                <Button variant="ghost" onClick={async () => {
                  if (confirm('高危操作：确认从数据库与硬盘彻底删除这张作品的所有信息与物理文件吗？')) {
                    await api.delete(`/api/admin/images/${img.id}`);
                    load();
                  }
                }} className="text-red-500 hover:bg-red-500/10 font-medium text-xs px-3 py-1.5 h-auto">删除</Button>
              </div>
            </td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  );
};

const AdminUsers = ({ currentUser }) => {
  const [data, setData] = useState({ data: [], pagination: {} });
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/api/admin/users?q=${encodeURIComponent(q)}`)
      .then(res => setData(res || { data: [], pagination: {} }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [q]);

  useEffect(() => { load(); }, [load]);

  const updateRole = async (id, role) => {
    if (confirm(`确认将用户角色设置为 ${role} 吗？`)) {
      await api.put(`/api/admin/users/${id}/role`, { role });
      load();
    }
  };

  const toggleBan = async (id, is_banned) => {
    if (confirm(`确认${is_banned ? '封禁' : '解封'}该用户吗？封禁后用户将无法登录。`)) {
      await api.put(`/api/admin/users/${id}/ban`, { is_banned });
      load();
    }
  };

  const deleteUser = async (id) => {
    if (confirm('警告！这将会级联删除该用户上传的所有作品及物理文件！确认删除吗？')) {
      await api.delete(`/api/admin/users/${id}`);
      load();
    }
  };

  return (
    <div className="animate-in fade-in">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3"><Users className="w-8 h-8"/> 用户管理</h1>
        <div className="flex items-center bg-zinc-900/50 border border-white/10 rounded-2xl px-4 py-2 w-80 focus-within:border-white/30 focus-within:shadow-[0_0_15px_rgba(255,255,255,0.05)] transition-all">
          <Search className="w-4 h-4 text-zinc-500 mr-2" />
          <input type="text" placeholder="搜索用户名..." value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} className="w-full bg-transparent border-none focus:outline-none text-sm text-white placeholder:text-zinc-600" />
        </div>
      </div>

      <div className="relative min-h-[300px]">
        {loading && <div className="absolute inset-0 z-10 bg-black/50 backdrop-blur-sm flex justify-center items-center rounded-3xl"><div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin"></div></div>}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.data.map(u => {
            const isSelf = currentUser && currentUser.id === u.id;
            const roleMap = { admin: { label: '管理员', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' }, trusted: { label: '信任用户', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' }, user: { label: '用户', cls: 'bg-zinc-800 text-zinc-400 border-white/10' } };
            const r = roleMap[u.role] || roleMap.user;
            return (
              <div key={u.id} className={`bg-zinc-950 rounded-2xl border ${u.is_banned ? 'border-red-500/20' : 'border-white/5'} p-5 hover:border-white/10 transition-all group`}>
                <div className="flex items-start gap-4">
                  <img src={u.avatar_url || `https://ui-avatars.com/api/?name=${u.username}&background=random&size=80`} className="w-12 h-12 rounded-xl border border-white/10 object-cover flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-bold text-white truncate">{u.username}</p>
                      {isSelf && <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-white flex-shrink-0">自己</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`px-2 py-0.5 text-[10px] rounded-md border ${r.cls}`}>{r.label}</span>
                      <span className="px-2 py-0.5 text-[10px] rounded-md border border-white/5 bg-zinc-900 text-zinc-500">{u.oidc_provider || 'local'}</span>
                      {u.is_banned && <span className="px-2 py-0.5 text-[10px] rounded-md border border-red-500/20 bg-red-500/10 text-red-400">封禁</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5">
                  <div className="flex items-center gap-4 text-[11px] text-zinc-500">
                    <span>作品 <strong className="text-zinc-300">{u.upload_count || 0}</strong></span>
                    <span>{new Date(u.created_at).toLocaleDateString()}</span>
                  </div>
                  {!isSelf && (
                    <div className="flex items-center gap-1">
                      <DropdownSelect
                        options={[
                          { value: 'user', label: '用户' },
                          { value: 'trusted', label: '信任' },
                          { value: 'admin', label: '管理员' }
                        ]}
                        value={u.role}
                        onChange={(val) => updateRole(u.id, val)}
                      />
                      {u.is_banned ? (
                        <Button variant="ghost" onClick={() => toggleBan(u.id, false)} className="text-emerald-400 text-[11px] px-2 py-1 h-auto">解封</Button>
                      ) : (
                        <Button variant="ghost" onClick={() => toggleBan(u.id, true)} className="text-orange-400 text-[11px] px-2 py-1 h-auto">封禁</Button>
                      )}
                      <Button variant="ghost" onClick={() => deleteUser(u.id)} className="text-red-500 hover:bg-red-500/10 text-[11px] px-2 py-1 h-auto"><Trash2 className="w-3 h-3"/></Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {data.data.length === 0 && !loading && (
          <div className="p-20 text-center text-zinc-500">没有查找到相关用户</div>
        )}
      </div>
    </div>
  );
};

const AdminOIDC = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/api/admin/oidc`)
      .then(res => setData(res || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openModal = (item) => {
    if (item) {
      setFormData({ ...item, client_secret: '' }); 
    } else {
      setFormData({ 
        name: '', display_name: '', issuer_url: '', 
        client_id: '', client_secret: '', redirect_uri: '', 
        enabled: true 
      });
    }
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (formData.id) {
        const payload = { ...formData };
        if (!payload.client_secret) delete payload.client_secret; 
        await api.put(`/api/admin/oidc/${formData.id}`, payload);
      } else {
        await api.post(`/api/admin/oidc`, formData);
      }
      setModalOpen(false);
      load();
    } catch (err) {
      alert('保存失败: ' + (err.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleEnabled = async (item) => {
    if (confirm(`确认${item.enabled ? '停用' : '启用'}此登录方式吗？`)) {
      await api.put(`/api/admin/oidc/${item.id}`, { enabled: !item.enabled });
      load();
    }
  };

  const deleteItem = async (id) => {
    if (confirm('警告！一旦删除将无法恢复，确认删除吗？')) {
      await api.delete(`/api/admin/oidc/${id}`);
      load();
    }
  };

  return (
    <div className="animate-in fade-in">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3"><LinkIcon className="w-8 h-8"/> 第三方登录配置</h1>
        <Button onClick={() => openModal(null)}>+ 新增提供商</Button>
      </div>

      <div className="bg-zinc-950 rounded-[2rem] border border-white/5 shadow-2xl overflow-hidden relative min-h-[400px]">
        {loading && <div className="absolute inset-0 z-10 bg-black/50 backdrop-blur-sm flex justify-center items-center"><div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin"></div></div>}
        <table className="w-full text-left text-sm text-zinc-300">
          <thead className="bg-zinc-900/50">
            <tr>
              <th className="p-5 font-medium text-zinc-400">提供商名称</th>
              <th className="p-5 font-medium text-zinc-400">Issuer URL</th>
              <th className="p-5 font-medium text-zinc-400">Client ID</th>
              <th className="p-5 font-medium text-zinc-400 text-center">状态</th>
              <th className="p-5 font-medium text-zinc-400 text-center">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {data.map(item => (
              <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                <td className="p-5 align-middle">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full border border-white/10 bg-zinc-800 flex items-center justify-center font-bold text-white relative flex-shrink-0 overflow-hidden">
                       {item.icon_url ? <img src={item.icon_url} className="w-full h-full object-cover" /> : item.display_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-bold text-white tracking-wide">{item.display_name}</p>
                      <p className="text-xs text-zinc-500 font-mono">ID: {item.name}</p>
                    </div>
                  </div>
                </td>
                <td className="p-5 align-middle"><span className="text-zinc-400 text-xs font-mono">{item.issuer_url}</span></td>
                <td className="p-5 align-middle"><span className="text-zinc-400 text-xs font-mono">{item.client_id}</span></td>
                <td className="p-5 align-middle text-center">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${item.enabled ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-zinc-800 text-zinc-400 border-white/10'}`}>
                    {item.enabled ? '已启用' : '已停用'}
                  </span>
                </td>
                <td className="p-5 align-middle text-center">
                  <div className="flex items-center justify-center gap-2">
                    <Button variant="ghost" onClick={() => toggleEnabled(item)} className="font-medium text-xs px-3 py-1.5 h-auto">{item.enabled ? '停用' : '启用'}</Button>
                    <Button variant="ghost" onClick={() => openModal(item)} className="font-medium text-xs px-3 py-1.5 h-auto text-blue-400">编辑</Button>
                    <Button variant="ghost" onClick={() => deleteItem(item.id)} className="font-medium text-xs px-3 py-1.5 h-auto text-red-500 hover:bg-red-500/10">删除</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && !loading && <div className="p-10 text-center text-zinc-500">暂无第三方登录配置</div>}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in overflow-y-auto">
          <div className="bg-zinc-950 border border-white/10 rounded-[2rem] w-full max-w-2xl shadow-2xl relative my-8 animate-in zoom-in-95 h-[90vh] flex flex-col">
            <div className="p-6 md:p-8 border-b border-white/10 flex justify-between items-center bg-zinc-900/50 flex-shrink-0">
              <h3 className="text-xl font-bold text-white">{formData.id ? '编辑提供商配置' : '新增 OIDC 提供商'}</h3>
              <button onClick={() => setModalOpen(false)} className="text-zinc-500 hover:text-white transition-colors"><X className="w-5 h-5"/></button>
            </div>
            <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar flex-1">
              <form id="oidc-form" onSubmit={save} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">唯一标识符 (name) <span className="text-red-500">*</span></label>
                    <input type="text" required disabled={!!formData.id} value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 disabled:opacity-50" placeholder="例如 linuxdo" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">显示名称 (display_name) <span className="text-red-500">*</span></label>
                    <input type="text" required value={formData.display_name} onChange={e=>setFormData({...formData, display_name: e.target.value})} className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30" placeholder="例如 LINUX DO" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-zinc-400 mb-2">颁发者地址 (issuer_url) <span className="text-red-500">*</span></label>
                    <input type="url" required value={formData.issuer_url} onChange={e=>setFormData({...formData, issuer_url: e.target.value})} className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-white/30" placeholder="例如 https://connect.linux.do" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">Client ID <span className="text-red-500">*</span></label>
                    <input type="text" required value={formData.client_id} onChange={e=>setFormData({...formData, client_id: e.target.value})} className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-white/30" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">Client Secret {formData.id ? '' : <span className="text-red-500">*</span>}</label>
                    <input type="password" required={!formData.id} value={formData.client_secret || ''} onChange={e=>setFormData({...formData, client_secret: e.target.value})} className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-white/30" placeholder={formData.id ? "留空表示不修改原密钥" : "必填"} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-zinc-400 mb-2">回调地址 (redirect_uri) <span className="text-red-500">*</span></label>
                    <input type="url" required value={formData.redirect_uri} onChange={e=>setFormData({...formData, redirect_uri: e.target.value})} className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-white/30" placeholder="例如 http://localhost:3000/api/auth/callback/linuxdo" />
                    <p className="text-[10px] text-zinc-500 mt-1.5">提示：此地址需和你在提供商后台填写的安全回调地址一致</p>
                  </div>
                </div>
              </form>
            </div>
            <div className="p-6 md:p-8 border-t border-white/10 flex justify-end gap-3 flex-shrink-0 bg-zinc-900/30">
              <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>取消</Button>
              <Button form="oidc-form" type="submit" disabled={submitting}>{submitting ? '保存中...' : '确认保存'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- APP ROOT ---
export default function App() {
  const [currentPath, setCurrentPath] = useState('/');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Basic Hash router
    const handleHash = () => { const path = window.location.hash.replace('#', '') || '/'; setCurrentPath(path); };
    window.addEventListener('hashchange', handleHash);
    handleHash();
    
    // Auth Check
    api.get('/api/auth/me').then(data => { setUser(data); setLoading(false); }).catch(() => { setUser(null); setLoading(false); });
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  // Update hash when navigating
  const navigate = (path) => { 
    window.location.hash = path; 
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
  };

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center"><Settings className="w-10 h-10 text-white animate-spin-slow" /></div>;

  const renderView = () => {
    if (currentPath.startsWith('/admin')) {
      if (!user || (user.role !== 'admin' && user.role !== 'trusted')) return <div className="p-20 text-red-500">Access Denied</div>;
      return (
        <AdminLayout currentPath={currentPath} navigate={navigate}>
          {currentPath === '/admin' && <AdminDashboard currentUser={user} />}
          {currentPath === '/admin/images' && <AdminImages currentUser={user} />}
          {currentPath === '/admin/users' && <AdminUsers currentUser={user} />}
          {currentPath === '/admin/oidc' && <AdminOIDC />}
        </AdminLayout>
      );
    }
    const qParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const q = qParams.get('q') || '';
    const basePath = currentPath.split('?')[0];

    switch (true) {
      case basePath === '/': return <HomeView navigate={navigate} searchQuery={q} />;
      case basePath.startsWith('/image/'): return <ImageDetailView imageId={basePath.split('/')[2]} navigate={navigate} user={user} />;
      case basePath.startsWith('/user/'): return <UserView userId={basePath.split('/')[2]} navigate={navigate} user={user} />;
      case basePath === '/upload': return <UploadView navigate={navigate} user={user} editId={qParams.get('edit') || null} />;
      case basePath === '/login': return <LoginView />;
      default: return <div className="pt-32 text-center text-zinc-600 font-mono text-lg">404 // NOT FOUND</div>;
    }
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-white/20 selection:text-white">
      {!currentPath.startsWith('/admin') && currentPath !== '/login' && <Navbar navigate={navigate} currentPath={currentPath} user={user} />}
      <main>{renderView()}</main>
    </div>
  );
}