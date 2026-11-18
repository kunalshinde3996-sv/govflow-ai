import { createContext, useContext, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('gf_user')); } catch { return null; }
  });
  const finish = ({ token, user }) => {
    localStorage.setItem('gf_token', token);
    localStorage.setItem('gf_user', JSON.stringify(user));
    setUser(user);
    return user;
  };
  const login = async (email, password) => finish(await api('/auth/login', { method: 'POST', body: { email, password } }));
  const register = async (name, email, password) => finish(await api('/auth/register', { method: 'POST', body: { name, email, password } }));
  const logout = () => {
    localStorage.removeItem('gf_token');
    localStorage.removeItem('gf_user');
    setUser(null);
  };
  return <Ctx.Provider value={{ user, login, register, logout }}>{children}</Ctx.Provider>;
}
