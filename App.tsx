
import React, { useState, useEffect } from 'react';
import { Subject, AppStep, Choice, StudentResult, QuestionResult } from './types';
import { analyzeAnswerSheet } from './services/geminiService';

interface NavbarProps {
  onOpenKey: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ onOpenKey }) => (
  <nav className="bg-blue-600 text-white p-4 shadow-md flex justify-between items-center sticky top-0 z-50">
    <div className="flex items-center gap-3">
      <div className="bg-white p-1 rounded-lg shadow-sm">
        <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" /></svg>
      </div>
      <h1 className="text-lg font-bold tracking-tight">ระบบตรวจข้อสอบ AI</h1>
    </div>
    <div className="flex items-center gap-2">
      <button 
        onClick={onOpenKey}
        className="bg-blue-700 hover:bg-blue-800 p-2 rounded-xl transition-all border border-blue-400/30 flex items-center gap-2 px-3 shadow-inner"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
        <span className="text-xs font-bold hidden xs:inline">ตั้งค่า API Key</span>
      </button>
    </div>
  </nav>
);

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.SUBJECT_LIST);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [activeSubject, setActiveSubject] = useState<Subject | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [isKeyProcessed, setIsKeyProcessed] = useState(false);

  // --- API Key Management ---
  const [userApiKey, setUserApiKey] = useState<string>(localStorage.getItem('user_api_key') || '');
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);

  // เด้ง Modal ทันทีถ้าไม่มี Key
  useEffect(() => {
    if (!userApiKey && !process.env.API_KEY) {
      const timer = setTimeout(() => setIsKeyModalOpen(true), 500);
      return () => clearTimeout(timer);
    }
  }, [userApiKey]);

  const handleSaveKey = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const key = formData.get('apiKey') as string;
    if (key && key.trim()) {
      localStorage.setItem('user_api_key', key.trim());
      setUserApiKey(key.trim());
      setIsKeyModalOpen(false);
      setIsAuthError(false);
      setErrorMessage(null);
    } else {
      alert("กรุณาระบุ API Key");
    }
  };

  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 1200; // ลดขนาดลงเล็กน้อยเพื่อความเร็วและลด error
          let w = img.width, h = img.height;
          if (w > h) { if (w > maxDim) { h *= maxDim / w; w = maxDim; } }
          else { if (h > maxDim) { w *= maxDim / h; h = maxDim; } }
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
      };
    });
  };

  const processKeyImage = async (file: File) => {
    if (!activeSubject) return;
    setIsLoading(true); setErrorMessage(null); setIsAuthError(false);
    try {
      const base64 = await resizeImage(file);
      const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, true, userApiKey);
      if (data.error) { 
        setErrorMessage(data.error); 
        if (data.isAuthError) setIsAuthError(true);
        return; 
      }
      const updated = { ...activeSubject, answerKey: data.answers };
      setActiveSubject(updated);
      setIsKeyProcessed(true);
    } catch (err: any) { 
      setErrorMessage(`เกิดข้อผิดพลาด: ${err.message || 'ไม่สามารถประมวลผลได้'}`); 
    }
    finally { setIsLoading(false); }
  };

  const processStudentImages = async (files: FileList) => {
    if (!activeSubject) return;
    setIsLoading(true); setErrorMessage(null); setIsAuthError(false);
    setProcessingProgress({ current: 0, total: files.length });
    const results = [...activeSubject.results];
    
    try {
      for (let i = 0; i < files.length; i++) {
        setProcessingProgress({ current: i + 1, total: files.length });
        const base64 = await resizeImage(files[i]);
        const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, false, userApiKey);
        
        if (data.error) {
          if (data.isAuthError) {
            setErrorMessage(data.error);
            setIsAuthError(true);
            break;
          }
          // กรณีมี error เฉพาะแผ่น ให้ข้ามไป
          continue;
        }

        const answers: QuestionResult[] = data.answers.map((ans, idx) => ({
          questionNo: idx + 1,
          studentAnswer: ans,
          correctAnswer: activeSubject.answerKey[idx],
          isCorrect: ans === activeSubject.answerKey[idx]
        }));

        results.push({
          id: Math.random().toString(36).substr(2, 9),
          studentNumber: data.studentId || (results.length + 1).toString(),
          studentName: data.studentName || "ไม่ทราบชื่อ",
          answers,
          totalScore: answers.filter(a => a.isCorrect).length,
          hasError: data.answers.some(a => a === null || a === 'multiple')
        });
      }
      
      const updated = { ...activeSubject, results };
      setActiveSubject(updated);
      setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
      setCurrentStep(AppStep.VIEW_RESULTS);
    } catch (err: any) { 
      setErrorMessage(`การสแกนล้มเหลว: ${err.message || 'Unknown error'}`); 
    }
    finally { setIsLoading(false); }
  };

  const exportToExcel = () => {
    if (!activeSubject) return;
    const headers = ['เลขที่', 'ชื่อ-นามสกุล', 'คะแนนที่ได้', 'คะแนนเต็ม'];
    const rows = activeSubject.results.map(r => [
      `"${r.studentNumber}"`,
      `"${r.studentName}"`,
      r.totalScore,
      activeSubject.totalQuestions
    ]);
    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `สรุปผลสอบ_${activeSubject.name}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] pb-20 selection:bg-blue-100">
      <Navbar onOpenKey={() => setIsKeyModalOpen(true)} />
      
      {/* API Key Modal - เด้งมาหน้าระบบเลย */}
      {isKeyModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[200] flex items-center justify-center p-4 transition-all duration-300">
          <div className="bg-white rounded-[2.5rem] p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95 fade-in duration-300">
            <div className="bg-blue-50 w-16 h-16 rounded-3xl flex items-center justify-center mb-6 mx-auto">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
            </div>
            <h2 className="text-2xl font-black mb-2 text-slate-800 text-center">เปิดใช้งาน AI</h2>
            <p className="text-sm text-slate-500 mb-8 text-center px-4 leading-relaxed">กรุณากรอก <b>Gemini API Key</b> ของคุณเพื่อเริ่มตรวจข้อสอบด้วย AI อัจฉริยะ</p>
            
            <form onSubmit={handleSaveKey} className="space-y-4">
              <div className="relative">
                <input 
                  name="apiKey"
                  type="password"
                  defaultValue={userApiKey}
                  placeholder="AIzaSy..."
                  className="w-full p-4 bg-slate-50 rounded-2xl outline-none focus:ring-4 ring-blue-500/10 border-2 border-slate-100 focus:border-blue-500 font-mono text-sm transition-all"
                  autoFocus
                />
              </div>
              <button 
                type="submit"
                className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black shadow-lg shadow-blue-500/30 hover:bg-blue-700 active:scale-[0.98] transition-all text-lg"
              >
                บันทึกและเริ่มต้น
              </button>
              {(userApiKey || process.env.API_KEY) && (
                <button 
                  type="button"
                  onClick={() => setIsKeyModalOpen(false)}
                  className="w-full py-2 text-slate-400 font-bold text-sm"
                >
                  ปิดหน้าต่างนี้
                </button>
              )}
            </form>
            
            <div className="mt-8 p-4 bg-blue-50 rounded-2xl text-[11px] text-blue-700 border border-blue-100 leading-relaxed">
              <strong>หมายเหตุ:</strong> ระบบใช้โมเดล <b>Gemini 3 Flash</b> ซึ่งมีความรวดเร็วและแม่นยำสูง หากยังไม่มี Key สามารถขอได้ที่เว็บไซต์ Google AI Studio
            </div>
          </div>
        </div>
      )}

      <main className="max-w-xl mx-auto p-4 space-y-4">
        
        {errorMessage && (
          <div className="bg-white border-2 border-red-100 p-6 rounded-[2rem] shadow-xl animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="flex gap-4">
              <div className="bg-red-50 p-3 rounded-2xl h-fit">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div className="flex-1">
                <div className="text-lg font-black text-slate-800 mb-1">เกิดข้อผิดพลาด</div>
                <div className="text-sm text-slate-500 font-medium leading-relaxed mb-4">{errorMessage}</div>
                
                <div className="flex flex-wrap gap-2">
                  <button 
                    onClick={() => setErrorMessage(null)} 
                    className="text-xs bg-slate-100 text-slate-600 px-4 py-2 rounded-xl font-bold hover:bg-slate-200 transition-colors"
                  >
                    รับทราบ
                  </button>
                  {isAuthError && (
                    <button 
                      onClick={() => setIsKeyModalOpen(true)}
                      className="text-xs bg-blue-600 text-white px-4 py-2 rounded-xl font-bold shadow-md shadow-blue-500/20"
                    >
                      🔄 ตั้งค่า API Key ใหม่
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex flex-col items-center justify-center p-6 text-center">
            <div className="bg-white p-10 rounded-[3rem] shadow-2xl flex flex-col items-center max-w-xs w-full">
              <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-6"></div>
              <p className="text-xl font-black text-slate-800">กำลังประมวลผล...</p>
              <p className="text-slate-400 text-sm mt-2 leading-relaxed">AI กำลังวิเคราะห์จุดฝนบนกระดาษคำตอบ</p>
              {processingProgress.total > 0 && (
                <div className="mt-6 w-full">
                  <div className="flex justify-between text-[10px] font-black text-blue-600 uppercase mb-2 tracking-widest">
                    <span>Processing Status</span>
                    <span>{Math.round((processingProgress.current / processingProgress.total) * 100)}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-600 transition-all duration-500 ease-out"
                      style={{ width: `${(processingProgress.current / processingProgress.total) * 100}%` }}
                    />
                  </div>
                  <p className="text-blue-600 font-black mt-3 text-xs">ใบที่ {processingProgress.current} จาก {processingProgress.total}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {currentStep === AppStep.SUBJECT_LIST && (
          <div className="space-y-4 animate-in fade-in duration-500">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-2xl font-black text-slate-800 tracking-tight">คลังรายวิชา</h2>
              <button onClick={() => setCurrentStep(AppStep.SETUP_SUBJECT)} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black shadow-lg shadow-blue-500/20 hover:bg-blue-700 active:scale-95 transition-all">+ วิชาใหม่</button>
            </div>
            {subjects.length === 0 ? (
              <div className="bg-white p-16 text-center rounded-[3rem] border-4 border-dashed border-slate-100 text-slate-300 flex flex-col items-center">
                <svg className="w-16 h-16 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.168.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5S19.832 5.477 21 6.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                <span className="font-bold text-lg">เริ่มสร้างวิชาแรกของคุณ</span>
                <p className="text-xs mt-2">เพิ่มข้อมูลรายวิชาและจำนวนข้อสอบเพื่อเริ่มสแกน</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {subjects.map(s => (
                  <div key={s.id} className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 flex justify-between items-center hover:shadow-md transition-shadow group">
                    <div>
                      <h3 className="font-black text-slate-800 text-lg group-hover:text-blue-600 transition-colors">{s.name}</h3>
                      <div className="flex gap-3 mt-1">
                        <span className="text-xs text-slate-400 font-bold bg-slate-50 px-2 py-1 rounded-md">{s.totalQuestions} ข้อ</span>
                        <span className="text-xs text-blue-500 font-bold bg-blue-50 px-2 py-1 rounded-md">ตรวจแล้ว {s.results.length} คน</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.VIEW_RESULTS); }} className="bg-slate-50 text-slate-600 px-4 py-2.5 rounded-xl font-bold text-xs hover:bg-slate-100 transition-colors">ดูผล</button>
                      <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.SCAN_STUDENTS); }} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-black text-xs shadow-md shadow-blue-500/20 hover:bg-blue-700 transition-colors">สแกนเพิ่ม</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {currentStep === AppStep.SETUP_SUBJECT && (
          <div className="bg-white p-10 rounded-[3rem] shadow-2xl space-y-8 animate-in zoom-in-95 duration-300">
            <div className="text-center">
              <h2 className="text-3xl font-black text-slate-800">สร้างวิชาใหม่</h2>
              <p className="text-slate-400 text-sm mt-2 font-medium">ระบุรายละเอียดพื้นฐานของชุดข้อสอบ</p>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const name = f.get('name') as string;
              const count = parseInt(f.get('count') as string);
              if (isNaN(count) || count <= 0) { alert("กรุณาระบุจำนวนข้อให้ถูกต้อง"); return; }
              const newSub: Subject = { id: Date.now().toString(), name, totalQuestions: count, answerKey: new Array(count).fill(null), results: [], createdAt: Date.now() };
              setSubjects([...subjects, newSub]); setActiveSubject(newSub); setIsKeyProcessed(false); setCurrentStep(AppStep.CALIBRATE_KEY);
            }} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">ชื่อวิชา / รหัสวิชา</label>
                <input required name="name" placeholder="ตัวอย่าง: ภาษาไทย ป.6" className="w-full p-5 bg-slate-50 rounded-[1.5rem] outline-none focus:ring-4 ring-blue-500/10 border-2 border-slate-100 focus:border-blue-500 font-bold transition-all" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">จำนวนข้อสอบทั้งหมด</label>
                <input required name="count" type="number" placeholder="เช่น 20" className="w-full p-5 bg-slate-50 rounded-[1.5rem] outline-none focus:ring-4 ring-blue-500/10 border-2 border-slate-100 focus:border-blue-500 font-bold transition-all" />
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white py-5 rounded-[1.5rem] font-black text-xl shadow-xl shadow-blue-500/30 hover:bg-blue-700 active:scale-95 transition-all mt-4">บันทึกและไปสแกนเฉลย</button>
            </form>
            <button onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="w-full text-slate-400 font-black text-sm hover:text-slate-600 transition-colors">ย้อนกลับ</button>
          </div>
        )}

        {currentStep === AppStep.CALIBRATE_KEY && activeSubject && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-white p-10 rounded-[3rem] border-4 border-dashed border-slate-200 text-center space-y-8 shadow-sm">
              <div className="bg-blue-50 w-20 h-20 rounded-[2rem] flex items-center justify-center mx-auto">
                <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <h2 className="font-black text-2xl text-slate-800">{isKeyProcessed ? 'เฉลยถูกนำเข้าแล้ว' : 'สแกนใบเฉลย'}</h2>
                <p className="text-sm text-slate-400 mt-2 leading-relaxed">กรุณาอัปโหลดรูปภาพใบเฉลยที่ฝนคำตอบที่ถูกต้องครบถ้วนแล้ว เพื่อใช้เป็นเกณฑ์ในการตรวจ</p>
              </div>

              {!isKeyProcessed ? (
                <div className="space-y-4">
                  <label className="block w-full bg-blue-600 text-white py-5 rounded-2xl font-black cursor-pointer shadow-xl shadow-blue-500/30 hover:bg-blue-700 active:scale-95 transition-all text-lg">
                    📸 เลือกรูปภาพใบเฉลย
                    <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files && processKeyImage(e.target.files[0])} />
                  </label>
                </div>
              ) : (
                <div className="grid grid-cols-5 sm:grid-cols-8 gap-2 p-4 bg-slate-50 rounded-[2rem] border border-slate-100 max-h-64 overflow-y-auto">
                  {activeSubject.answerKey.map((ans, i) => (
                    <div key={i} className="text-center p-3 bg-white rounded-2xl shadow-sm border border-slate-50">
                      <div className="text-[10px] font-black text-slate-300 mb-1">{i+1}</div>
                      <div className="font-black text-blue-600 text-lg">{ans || '?'}</div>
                    </div>
                  ))}
                </div>
              )}
              {isKeyProcessed && (
                <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="w-full bg-green-600 text-white py-5 rounded-2xl font-black shadow-xl shadow-green-500/20 hover:bg-green-700 active:scale-95 transition-all text-xl">ตรวจข้อสอบนักเรียน</button>
              )}
            </div>
            <button onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="w-full text-slate-400 font-black text-sm">ยกเลิก</button>
          </div>
        )}

        {currentStep === AppStep.SCAN_STUDENTS && activeSubject && (
          <div className="bg-white p-12 rounded-[3.5rem] text-center space-y-8 shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="bg-blue-600 w-24 h-24 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-xl shadow-blue-500/40">
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
            <div>
              <h2 className="font-black text-3xl text-slate-800">เริ่มสแกนตรวจ</h2>
              <p className="text-slate-400 text-sm mt-3 leading-relaxed">ถ่ายรูปหรือเลือกใบคำตอบนักเรียน<br/>(สามารถเลือกพร้อมกันได้หลายไฟล์)</p>
            </div>
            <label className="block w-full bg-blue-600 text-white py-6 rounded-3xl font-black cursor-pointer shadow-2xl shadow-blue-500/40 hover:bg-blue-700 active:scale-95 transition-all text-xl">
              📂 เลือกไฟล์เพื่อตรวจ
              <input type="file" accept="image/*" multiple className="hidden" onChange={e => e.target.files && processStudentImages(e.target.files)} />
            </label>
            <button onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="w-full text-slate-400 font-black text-sm">กลับไปหน้ารวมวิชา</button>
          </div>
        )}

        {currentStep === AppStep.VIEW_RESULTS && activeSubject && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="bg-white p-8 rounded-[3rem] shadow-sm space-y-6 border border-slate-100">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-2xl font-black text-slate-800 leading-tight">ผลการสอบ</h2>
                  <p className="text-slate-400 text-sm font-bold mt-1 uppercase tracking-wider">{activeSubject.name}</p>
                </div>
                <button onClick={exportToExcel} className="bg-green-100 text-green-700 px-4 py-3 rounded-2xl font-black text-xs shadow-sm hover:bg-green-200 transition-colors flex items-center gap-2">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  XLSX
                </button>
              </div>
              
              <div className="overflow-hidden rounded-[2rem] border border-slate-50">
                <table className="w-full text-left">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="py-4 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">ID</th>
                      <th className="py-4 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">ชื่อ-สกุล</th>
                      <th className="py-4 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">คะแนน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {activeSubject.results.length === 0 ? (
                      <tr><td colSpan={3} className="py-10 text-center text-slate-300 font-bold">ยังไม่มีข้อมูลการตรวจ</td></tr>
                    ) : (
                      activeSubject.results.map((r, i) => (
                        <tr key={i} className="hover:bg-blue-50/30 transition-colors group">
                          <td className="py-5 px-4 font-mono text-xs text-slate-400">{r.studentNumber}</td>
                          <td className="py-5 px-4">
                            <div className="font-black text-slate-700 text-sm">{r.studentName}</div>
                            {r.hasError && <span className="text-[10px] text-orange-500 font-black uppercase">⚠️ มีข้อผิดพลาด</span>}
                          </td>
                          <td className="py-5 px-4 text-right">
                            <span className="bg-blue-600 text-white px-4 py-1.5 rounded-full font-black text-sm shadow-md shadow-blue-500/20">
                              {r.totalScore}/{activeSubject.totalQuestions}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="bg-slate-200 text-slate-600 py-5 rounded-3xl font-black text-lg hover:bg-slate-300 transition-colors">กลับหน้าหลัก</button>
              <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="bg-blue-600 text-white py-5 rounded-3xl font-black text-lg shadow-xl shadow-blue-500/20 hover:bg-blue-700 transition-colors">ตรวจเพิ่ม</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
