import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { App } from './App';
import './style.css';
createRoot(document.getElementById('root')!).render(<ConfigProvider locale={zhCN} theme={{
  token: { colorPrimary: '#2167e8', colorInfo: '#2167e8', colorText: '#1e293b', colorTextSecondary: '#64748b', colorBorder: '#e6eaf0', colorBgLayout: '#f5f7fb', borderRadius: 8, controlHeight: 36, fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif' },
  components: { Table: { headerBg: '#f5f7fb', cellPaddingBlock: 16 }, Tabs: { horizontalItemGutter: 32 }, Modal: { borderRadiusLG: 12 }, Card: { borderRadiusLG: 12 } },
}}><App /></ConfigProvider>);
