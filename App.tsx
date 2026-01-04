
import React, { useState, useEffect } from 'react';
import { Subject, AppStep, Choice, StudentResult, QuestionResult } from './types';
import { analyzeAnswerSheet } from './services/geminiService';

// UI Components
const Navbar = () => (
  <nav className="bg-blue-600 text-white p-4 shadow-lg flex justify-between items-center sticky top-0 z-50">
    <div className="flex items-center gap-3">
      <div className="bg-white p-1.5 rounded-xl shadow-inner">
        <svg className="w-8 h-8 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
          <path d="M12 15.5l-4.5 2 4.5-10 4.5 10z" opacity=".3" />
          <path d="M12 11l-2 4.5h4z" />
        </svg>
      </div>
      <div>
        <h1 className="text-xl font-bold tracking-tight leading-none">ระบบตอดสวบ</h1>
        <span className="text-[10px] uppercase tracking-widest opacity-70 font-bold">Smart OMR AI Core</span>
      </div>
    </div>
    <div className="text-sm bg-blue-700/50 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10 font-medium">v2.1 (AI Active)</div>
  </nav>
);

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.SUBJECT_LIST);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [activeSubject, setActiveSubject] = useState<Subject | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [isApiKeyActive, setIsApiKeyActive] = useState<boolean>(true);

  // ตรวจสอบความพร้อมของ AI
  useEffect(() => {
    const checkStatus = async () => {
      if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
        const has = await window.aistudio.hasSelectedApiKey();
        setIsApiKeyActive(has || !!process.env.API_KEY);
      } else {
        setIsApiKeyActive(!!process.env.API_KEY);
      }
    };
    checkStatus();
  }, []);

  const handleOpenKeySelector = async () => {
    if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
      try {
        await window.aistudio.openSelectKey();
        setIsApiKeyActive(true);
        setErrorMessage(null);
      } catch (e) {
        console.error("Setup Error:", e);
      }
    }
  };

  // Persistence
  useEffect(() => {
    try {
      const saved = localStorage.getItem('omr_subjects');
      if (saved) setSubjects(JSON.parse(saved));
    } catch (e) {
      console.error("Load Error:", e);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('omr_subjects', JSON.stringify(subjects));
  }, [subjects]);

  const handleCreateSubject = (name: string, count: number) => {
    const newSubject: Subject = {
      id: Date.now().toString(),
      name,
      totalQuestions: count,
      answerKey: new Array(count).fill(null),
      results: [],
      createdAt: Date.now()
    };
    setSubjects([...subjects, newSubject]);
    setActiveSubject(newSubject);
    setCurrentStep(AppStep.CALIBRATE_KEY);
  };

  const deleteSubject = (id: string) => {
    if (window.confirm('ลบรายวิชานี้?')) {
      const updated = subjects.filter(s => s.id !== id);
      setSubjects(updated);
      if (activeSubject?.id === id) setActiveSubject(null);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const processKeyImage = async (file: File) => {
    if (!activeSubject) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const base64 = await fileToBase64(file);
      const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, true);
      
      if (data.error) {
        setErrorMessage(data.error);
        return;
      }

      const updated = { ...activeSubject, answerKey: data.answers };
      setActiveSubject(updated);
      setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
    } catch (err) {
      setErrorMessage("AI ประมวลผลเฉลยล้มเหลว");
    } finally {
      setIsLoading(false);
    }
  };

  const processStudentImages = async (files: FileList) => {
    if (!activeSubject) return;
    setIsLoading(true);
    setErrorMessage(null);
    setProcessingProgress({ current: 0, total: files.length });
    const newResults: StudentResult[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        setProcessingProgress({ current: i + 1, total: files.length });
        const base64 = await fileToBase64(files[i]);
        const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, false);
        
        if (data.error) continue;

        const answers: QuestionResult[] = data.answers.map((ans, idx) => ({
          questionNo: idx + 1,
          studentAnswer: ans,
          correctAnswer: activeSubject.answerKey[idx],
          isCorrect: ans === activeSubject.answerKey[idx]
        }));

        const totalScore = answers.filter(a => a.isCorrect).length;
        const hasError = data.answers.some(a => a === null || a === 'multiple');

        newResults.push({
          id: Math.random().toString(36).substr(2, 9),
          studentNumber: data.studentId || "",
          studentName: data.studentName || "",
          answers,
          totalScore,
          hasError,
          errorMessage: hasError ? "ข้อมูลไม่ครบถ้วน" : undefined
        });
      }

      if (newResults.length > 0) {
        const combined = [...activeSubject.results, ...newResults];
        const updated = { ...activeSubject, results: combined };
        setActiveSubject(updated);
        setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
        setCurrentStep(AppStep.VIEW_RESULTS);
      }
    } catch (err) {
      setErrorMessage("เกิดข้อผิดพลาดในการตรวจแผ่นคำตอบ");
    } finally {
      setIsLoading(false);
      setProcessingProgress({ current: 0, total: 0 });
    }
  };

  const exportToCSV = () => {
    if (!activeSubject) return;
    const headers = ["เลขที่", "ชื่อ", "คะแนน"];
    const rows = activeSubject.results.map(r => [r.studentNumber, r.studentName, r.totalScore]);
    let csv = "\uFEFF" + headers.join(",") + "\n" + rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `คะแนน_${activeSubject.name}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen pb-20">
      <Navbar />

      <main className="max-w-4xl mx-auto p-4 md:p-8">
        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex items-center justify-between shadow-sm">
            <p className="text-red-700 text-sm font-bold">{errorMessage}</p>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 font-bold">ปิด</button>
          </div>
        )}

        {/* LOADING OVERLAY */}
        {isLoading && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex flex-col items-center justify-center text-white">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-400 mb-4"></div>
            <p className="text-xl font-bold">AI กำลังประมวลผลภาพ...</p>
            {processingProgress.total > 0 && (
              <p className="mt-2 opacity-70">กำลังตรวจแผ่นที่ {processingProgress.current} จาก {processingProgress.total}</p>
            )}
          </div>
        )}

        {/* STEP VIEWS */}
        {currentStep === AppStep.SUBJECT_LIST && (
          <section className="space-y-6 animate-fadeIn">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-black text-gray-800">รายวิชาทั้งหมด</h2>
              <button 
                onClick={() => setCurrentStep(AppStep.SETUP_SUBJECT)}
                className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:bg-blue-700 transition"
              >
                + สร้างวิชาใหม่
              </button>
            </div>

            {subjects.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-gray-200 rounded-[2rem] p-20 text-center text-gray-400">
                ยังไม่มีวิชาที่คุณสร้างไว้ เริ่มต้นสร้างวิชาเพื่อใช้ AI ตรวจข้อสอบ
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {subjects.map(s => (
                  <div key={s.id} className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-md transition">
                    <h3 className="text-xl font-black text-gray-800">{s.name}</h3>
                    <p className="text-sm text-gray-500 mt-1">{s.totalQuestions} ข้อ | {s.results.length} แผ่นนักเรียน</p>
                    <div className="flex gap-3 mt-4">
                      <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.VIEW_RESULTS); }} className="flex-1 bg-gray-100 py-2 rounded-xl font-bold text-gray-600">ผลลัพธ์</button>
                      <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.SCAN_STUDENTS); }} className="flex-1 bg-blue-600 py-2 rounded-xl font-bold text-white">เริ่มสแกน</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {currentStep === AppStep.SETUP_SUBJECT && (
          <section className="bg-white p-10 rounded-[2.5rem] shadow-xl max-w-md mx-auto animate-fadeIn">
            <h2 className="text-2xl font-black mb-6 text-gray-800">ตั้งค่ารายวิชา</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              handleCreateSubject(d.get('name') as string, parseInt(d.get('count') as string));
            }} className="space-y-4">
              <input required name="name" placeholder="ชื่อวิชา เช่น สังคมศึกษา ม.1" className="w-full px-5 py-4 rounded-2xl border border-gray-200 outline-none focus:border-blue-500" />
              <input required name="count" type="number" min="1" max="100" placeholder="จำนวนข้อ (1-100)" className="w-full px-5 py-4 rounded-2xl border border-gray-200 outline-none focus:border-blue-500" />
              <button className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black shadow-lg">ยืนยันและไปต่อ</button>
            </form>
          </section>
        )}

        {currentStep === AppStep.CALIBRATE_KEY && activeSubject && (
          <section className="space-y-8 animate-fadeIn text-center">
            <h2 className="text-3xl font-black text-gray-800">ระบุเฉลยที่ถูกต้อง</h2>
            <div className="relative group overflow-hidden rounded-[3rem] h-48 shadow-xl bg-white border-4 border-dashed border-blue-50 flex items-center justify-center cursor-pointer">
              <input type="file" accept="image/*" className="absolute inset-0 opacity-0 z-10 cursor-pointer" onChange={(e) => e.target.files && processKeyImage(e.target.files[0])} />
              <div className="text-blue-600 font-bold">
                <p className="text-lg">คลิกเพื่ออัปโหลด "แผ่นเฉลย"</p>
                <p className="text-xs opacity-60 mt-1">AI จะทำการอ่านเฉลยให้คุณอัตโนมัติ</p>
              </div>
            </div>
            
            <div className="bg-white p-8 rounded-[2rem] shadow-lg text-left overflow-x-auto">
              <h3 className="font-black text-lg mb-6">ตารางเฉลยคำตอบ</h3>
              <div className="grid grid-cols-5 sm:grid-cols-10 gap-3">
                {activeSubject.answerKey.map((ans, i) => (
                  <div key={i} className="text-center">
                    <p className="text-[10px] font-bold text-gray-400 mb-1">{i+1}</p>
                    <select value={ans || ''} onChange={(e) => {
                      const nk = [...activeSubject.answerKey];
                      nk[i] = (e.target.value as Choice) || null;
                      const up = { ...activeSubject, answerKey: nk };
                      setActiveSubject(up);
                      setSubjects(subjects.map(s => s.id === up.id ? up : s));
                    }} className="w-full bg-gray-50 border-none rounded-lg p-1 text-blue-600 font-bold outline-none">
                      <option value="">-</option>
                      <option value="ก">ก</option><option value="ข">ข</option>
                      <option value="ค">ค</option><option value="ง">ง</option>
                    </select>
                  </div>
                ))}
              </div>
              <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="w-full bg-blue-600 text-white py-4 mt-8 rounded-2xl font-black shadow-lg">ไปขั้นตอนสแกนตรวจแผ่นคำตอบ</button>
            </div>
          </section>
        )}

        {currentStep === AppStep.SCAN_STUDENTS && activeSubject && (
          <section className="space-y-10 animate-fadeIn text-center">
             <h2 className="text-3xl font-black text-gray-800">สแกนตรวจแผ่นนักเรียน</h2>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="relative group overflow-hidden rounded-[2.5rem] h-64 shadow-xl bg-blue-600 text-white flex flex-col items-center justify-center cursor-pointer">
                   <input type="file" accept="image/*" capture="environment" className="absolute inset-0 opacity-0 z-10 cursor-pointer" onChange={(e) => e.target.files && processStudentImages(e.target.files)} />
                   <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                   <span className="text-xl font-bold">เปิดกล้องสแกน</span>
                </div>
                <div className="relative group overflow-hidden rounded-[2.5rem] h-64 shadow-xl bg-white border-4 border-dashed border-gray-100 flex flex-col items-center justify-center cursor-pointer">
                   <input type="file" multiple accept="image/*" className="absolute inset-0 opacity-0 z-10 cursor-pointer" onChange={(e) => e.target.files && processStudentImages(e.target.files)} />
                   <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                   <span className="text-xl font-bold text-gray-400">เลือกไฟล์จากเครื่อง</span>
                </div>
             </div>
             <button onClick={() => setCurrentStep(AppStep.VIEW_RESULTS)} className="text-blue-600 font-bold underline">ดูผลลัพธ์ที่ตรวจแล้ว</button>
          </section>
        )}

        {currentStep === AppStep.VIEW_RESULTS && activeSubject && (
          <section className="space-y-6 animate-fadeIn pb-20">
            <div className="flex justify-between items-center">
              <h2 className="text-3xl font-black text-gray-800">{activeSubject.name}</h2>
              <button onClick={exportToCSV} className="bg-green-600 text-white px-6 py-2 rounded-xl font-bold shadow-md">ส่งออก CSV</button>
            </div>
            
            <div className="bg-white rounded-[2rem] shadow-lg border border-gray-50 overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-gray-50">
                  <tr className="text-xs font-black text-gray-400 uppercase tracking-widest border-b">
                    <th className="px-6 py-4">เลขที่</th>
                    <th className="px-6 py-4">ชื่อ</th>
                    <th className="px-6 py-4 text-center">คะแนน</th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {activeSubject.results.map(r => (
                    <tr key={r.id} className="hover:bg-blue-50 transition">
                      <td className="px-6 py-4 font-black">{r.studentNumber}</td>
                      <td className="px-6 py-4 font-bold text-gray-600">{r.studentName}</td>
                      <td className="px-6 py-4 text-center">
                        <span className="bg-blue-50 text-blue-600 px-4 py-1 rounded-full font-black">{r.totalScore} / {activeSubject.totalQuestions}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => {
                          const res = activeSubject.results.filter(x => x.id !== r.id);
                          const up = { ...activeSubject, results: res };
                          setActiveSubject(up);
                          setSubjects(subjects.map(s => s.id === up.id ? up : s));
                        }} className="text-red-300 hover:text-red-600">ลบ</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      <footer className="fixed bottom-0 inset-x-0 bg-white/80 backdrop-blur-md p-4 border-t border-gray-100 flex justify-between items-center px-10">
        <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">TODSUAB SMART AI</span>
        <div className={`px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${isApiKeyActive ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
           AI Engine: {isApiKeyActive ? 'Active' : 'Offline'}
        </div>
      </footer>
    </div>
  );
};

export default App;
