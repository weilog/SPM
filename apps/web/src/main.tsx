import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { App } from './App';
import './style.css';
createRoot(document.getElementById('root')!).render(<ConfigProvider locale={zhCN} theme={{
  token: { colorPrimary: '#217568', colorInfo: '#217568', colorText: '#203c38', colorTextSecondary: '#70827e', colorBorder: '#dce6e2', colorBgLayout: '#f5f7f5', borderRadius: 12, controlHeight: 40, fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif' },
  components: { Button: { primaryShadow: '0 4px 12px rgba(33,117,104,.16)' }, Table: { headerBg: '#f5f8f6', cellPaddingBlock: 18 }, Tabs: { horizontalItemGutter: 32 }, Modal: { borderRadiusLG: 20 }, Card: { borderRadiusLG: 18 } },
}}><App /></ConfigProvider>);
