
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
        <span className="text-[10px] uppercase tracking-widest opacity-70">Smart OMR Checker</span>
      </div>
    </div>
    <div className="text-sm bg-blue-700/50 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10 font-medium">v1.5 (Branding Update)</div>
  </nav>
);

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.SUBJECT_LIST);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [activeSubject, setActiveSubject] = useState<Subject | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });

  // Persistence with Error Handling
  useEffect(() => {
    try {
      const saved = localStorage.getItem('omr_subjects');
      if (saved) setSubjects(JSON.parse(saved));
    } catch (e) {
      console.error("Failed to load local data", e);
      localStorage.removeItem('omr_subjects');
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
    setErrorMessage(null);
  };

  const deleteSubject = (id: string) => {
    if (window.confirm('ยืนยันการลบรายวิชานี้? ข้อมูลทั้งหมดจะหายไป')) {
      const updatedSubjects = subjects.filter(s => s.id !== id);
      setSubjects(updatedSubjects);
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
    setProcessingProgress({ current: 1, total: 1 });
    try {
      const base64 = await fileToBase64(file);
      const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, true);
      
      if (data.error) {
        setErrorMessage(data.error);
        return;
      }

      const updatedSubject = { ...activeSubject, answerKey: data.answers };
      setActiveSubject(updatedSubject);
      setSubjects(subjects.map(s => s.id === updatedSubject.id ? updatedSubject : s));
    } catch (err) {
      setErrorMessage("เกิดข้อผิดพลาดในการประมวลผลภาพเฉลย กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsLoading(false);
      setProcessingProgress({ current: 0, total: 0 });
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
          errorMessage: hasError ? "ตรวจพบข้อที่ไม่ได้ตอบหรือตอบมากกว่าหนึ่ง" : undefined
        });
      }

      if (newResults.length === 0) {
        setErrorMessage("ไม่พบข้อมูลกระดาษคำตอบที่ถูกต้องจากไฟล์ที่อัปโหลด");
      } else {
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        const combinedResults = [...activeSubject.results, ...newResults];
        
        const sortedResults = combinedResults.sort((a, b) => 
          collator.compare(a.studentNumber || "999", b.studentNumber || "999")
        );

        const updatedSubject = { 
          ...activeSubject, 
          results: sortedResults
        };
        setActiveSubject(updatedSubject);
        setSubjects(subjects.map(s => s.id === updatedSubject.id ? updatedSubject : s));
        setCurrentStep(AppStep.VIEW_RESULTS);
      }
    } catch (err) {
      setErrorMessage("เกิดข้อผิดพลาดในการประมวลผลภาพนักเรียน");
    } finally {
      setIsLoading(false);
      setProcessingProgress({ current: 0, total: 0 });
    }
  };

  const exportToCSV = () => {
    if (!activeSubject) return;
    const headers = ["เลขที่", "ชื่อ", "คะแนน", "สถานะ"];
    const rows = activeSubject.results.map(r => [
      r.studentNumber,
      r.studentName,
      r.totalScore,
      r.hasError ? "มีข้อผิดพลาด" : "ปกติ"
    ]);
    
    let csvContent = "\uFEFF"; 
    csvContent += headers.join(",") + "\n";
    rows.forEach(row => {
      csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `results_${activeSubject.name}.csv`);
    link.click();
  };

  return (
    <div className="min-h-screen pb-20">
      <Navbar />

      <main className="max-w-4xl mx-auto p-4 md:p-8">
        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex items-start gap-3 animate-fadeIn">
            <svg className="w-6 h-6 text-red-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <div>
              <p className="font-bold text-red-800">เกิดข้อผิดพลาด</p>
              <p className="text-red-700 text-sm">{errorMessage}</p>
            </div>
            <button onClick={() => setErrorMessage(null)} className="ml-auto text-red-400 hover:text-red-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        )}

        {/* WIZARD PROGRESS BAR */}
        {currentStep !== AppStep.SUBJECT_LIST && (
           <div className="mb-8 flex items-center justify-between">
              <button 
                onClick={() => { setCurrentStep(AppStep.SUBJECT_LIST); setErrorMessage(null); }}
                className="flex items-center gap-1 text-gray-500 hover:text-blue-600 transition p-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                กลับหน้าหลัก
              </button>
              <div className="flex gap-2">
                {[1, 2, 3, 4].map(i => (
                   <div key={i} className={`w-3 h-3 rounded-full ${
                     (i === 1 && currentStep === AppStep.SETUP_SUBJECT) ||
                     (i === 2 && currentStep === AppStep.CALIBRATE_KEY) ||
                     (i === 3 && currentStep === AppStep.SCAN_STUDENTS) ||
                     (i === 4 && currentStep === AppStep.VIEW_RESULTS) 
                     ? 'bg-blue-600' : 'bg-gray-300'
                   }`} />
                ))}
              </div>
           </div>
        )}

        {/* LOADING OVERLAY */}
        {isLoading && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[100] flex flex-col items-center justify-center text-white p-6 text-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 rounded-full border-4 border-blue-400/20"></div>
              <div className="animate-spin rounded-full h-24 w-24 border-t-4 border-blue-400 shadow-2xl"></div>
            </div>
            
            <p className="text-2xl font-bold mb-4">กำลังประมวลผลอัจฉริยะ...</p>
            
            {processingProgress.total > 0 && (
              <div className="w-full max-w-xs space-y-4 animate-fadeIn">
                <div className="flex justify-between text-sm font-medium text-blue-200">
                  <span>กำลังตรวจแผ่นที่ {processingProgress.current} จาก {processingProgress.total}</span>
                  <span>{Math.round((processingProgress.current / processingProgress.total) * 100)}%</span>
                </div>
                <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden border border-white/5">
                  <div 
                    className="h-full bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)] transition-all duration-500 ease-out"
                    style={{ width: `${(processingProgress.current / processingProgress.total) * 100}%` }}
                  ></div>
                </div>
                <p className="text-blue-300 text-xs leading-relaxed opacity-80">
                  AI กำลังวิเคราะห์ชื่อและคะแนนจากภาพถ่ายทีละแผ่น <br/> กรุณารอสักครู่...
                </p>
              </div>
            )}
          </div>
        )}

        {/* VIEWS */}
        {currentStep === AppStep.SUBJECT_LIST && (
          <section className="space-y-6 animate-fadeIn">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-800">รายวิชาของฉัน</h2>
              <button 
                onClick={() => { setCurrentStep(AppStep.SETUP_SUBJECT); setErrorMessage(null); }}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold shadow-md active:scale-95 transition-all flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
                สร้างรายวิชาใหม่
              </button>
            </div>

            {subjects.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-gray-200 rounded-3xl p-12 text-center text-gray-400">
                <svg className="w-16 h-16 mx-auto mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
                <p>ยังไม่มีรายวิชา เริ่มต้นสร้างรายวิชาแรกของคุณ</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {subjects.map(s => (
                  <div key={s.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition group">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-xl font-bold text-gray-800">{s.name}</h3>
                        <p className="text-gray-500 text-sm">{s.totalQuestions} ข้อ • ตรวจแล้ว {s.results.length} แผ่น</p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); deleteSubject(s.id); }} className="text-red-300 hover:text-red-500 transition p-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.VIEW_RESULTS); setErrorMessage(null); }}
                        className="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-medium transition"
                      >
                        ดูผลคะแนน
                      </button>
                      <button 
                        onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.SCAN_STUDENTS); setErrorMessage(null); }}
                        className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-600 py-2 rounded-lg text-sm font-medium transition"
                      >
                        ตรวจเพิ่ม
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {currentStep === AppStep.SETUP_SUBJECT && (
          <section className="bg-white p-8 rounded-3xl shadow-sm max-w-lg mx-auto animate-fadeIn">
            <h2 className="text-2xl font-bold mb-6">ตั้งค่ารายวิชา</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              handleCreateSubject(formData.get('name') as string, parseInt(formData.get('count') as string));
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อรายวิชา</label>
                  <input required name="name" type="text" placeholder="เช่น วิทยาศาสตร์ ม.3" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนข้อสอบ (สูงสุด 100 ข้อ)</label>
                  <input required name="count" type="number" min="1" max="100" placeholder="จำนวนข้อจริง" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:bg-blue-700 transition active:scale-95">
                  ถัดไป: อัปโหลดเฉลย
                </button>
              </div>
            </form>
          </section>
        )}

        {currentStep === AppStep.CALIBRATE_KEY && activeSubject && (
          <section className="space-y-8 animate-fadeIn text-center">
            <div className="max-w-md mx-auto">
              <h2 className="text-2xl font-bold mb-2">อัปโหลดเฉลยต้นแบบ</h2>
              <p className="text-gray-500 mb-8 text-sm">อัปโหลดภาพกระดาษคำตอบที่คุณระบายเฉลยไว้ เพื่อใช้เป็นเกณฑ์การตรวจ</p>
              
              <div className="relative group overflow-hidden rounded-3xl h-48">
                <input 
                  type="file" 
                  accept="image/*" 
                  className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full h-full" 
                  onChange={(e) => e.target.files && processKeyImage(e.target.files[0])}
                />
                <div className="border-4 border-dashed border-gray-200 group-hover:border-blue-300 rounded-3xl p-8 transition bg-white pointer-events-none h-full flex flex-col items-center justify-center">
                  <svg className="w-12 h-12 mx-auto mb-2 text-blue-500 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                  <span className="text-lg font-semibold text-gray-600 block">กดเพื่อเลือกรูปภาพเฉลย</span>
                </div>
              </div>
            </div>

            {activeSubject.answerKey.some(a => a !== null) && (
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 text-left animate-fadeIn">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <span className="w-2 h-6 bg-green-500 rounded-full"></span>
                  ตรวจสอบเฉลยที่ AI ตรวจพบ
                </h3>
                <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
                  {activeSubject.answerKey.map((ans, idx) => (
                    <div key={idx} className="flex flex-col items-center p-2 rounded-lg bg-gray-50 border border-gray-100">
                      <span className="text-[10px] text-gray-400 font-bold uppercase">ข้อ {idx + 1}</span>
                      <select 
                        value={ans || ''} 
                        onChange={(e) => {
                          const newKey = [...activeSubject.answerKey];
                          newKey[idx] = (e.target.value as Choice) || null;
                          const updated = { ...activeSubject, answerKey: newKey };
                          setActiveSubject(updated);
                          setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
                        }}
                        className="bg-transparent font-bold text-blue-600 outline-none text-center appearance-none cursor-pointer w-full"
                      >
                        <option value="">-</option>
                        <option value="ก">ก</option>
                        <option value="ข">ข</option>
                        <option value="ค">ค</option>
                        <option value="ง">ง</option>
                      </select>
                    </div>
                  ))}
                </div>
                <button 
                  onClick={() => { setCurrentStep(AppStep.SCAN_STUDENTS); setErrorMessage(null); }}
                  className="mt-8 w-full bg-blue-600 text-white py-4 rounded-xl font-bold shadow-lg hover:bg-blue-700 transition active:scale-95"
                >
                  ยืนยันเฉลยและเริ่มตรวจ
                </button>
              </div>
            )}
          </section>
        )}

        {currentStep === AppStep.SCAN_STUDENTS && activeSubject && (
          <section className="space-y-8 animate-fadeIn text-center">
            <div className="max-w-lg mx-auto">
              <h2 className="text-2xl font-bold mb-2">ตรวจกระดาษคำตอบนักเรียน</h2>
              <p className="text-gray-500 mb-8 text-sm">เลือกวิธีนำเข้าภาพกระดาษคำตอบของคุณ</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* BUTTON: CAMERA */}
                <div className="relative group overflow-hidden rounded-3xl h-56 shadow-sm hover:shadow-md transition">
                  <input 
                    type="file" 
                    accept="image/*" 
                    capture="environment"
                    className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full h-full" 
                    onChange={(e) => e.target.files && processStudentImages(e.target.files)}
                  />
                  <div className="border-2 border-blue-100 group-hover:border-blue-400 rounded-3xl p-8 transition bg-white pointer-events-none h-full flex flex-col items-center justify-center">
                    <div className="bg-blue-100 p-4 rounded-full mb-4">
                      <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
                      </svg>
                    </div>
                    <span className="text-lg font-bold text-gray-800">ถ่ายภาพด้วยกล้อง</span>
                    <span className="text-xs text-gray-400 mt-1">ตรวจทีละแผ่นทันที</span>
                  </div>
                </div>

                {/* BUTTON: UPLOAD FILE */}
                <div className="relative group overflow-hidden rounded-3xl h-56 shadow-sm hover:shadow-md transition">
                  <input 
                    type="file" 
                    multiple 
                    accept="image/*" 
                    className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full h-full" 
                    onChange={(e) => e.target.files && processStudentImages(e.target.files)}
                  />
                  <div className="border-2 border-gray-100 group-hover:border-blue-300 rounded-3xl p-8 transition bg-white pointer-events-none h-full flex flex-col items-center justify-center">
                    <div className="bg-gray-100 p-4 rounded-full mb-4">
                      <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                      </svg>
                    </div>
                    <span className="text-lg font-bold text-gray-800">อัปโหลดรูปภาพ</span>
                    <span className="text-xs text-gray-400 mt-1">เลือกได้หลายภาพจากเครื่อง</span>
                  </div>
                </div>
              </div>
            </div>

            {activeSubject.results.length > 0 && (
              <button 
                onClick={() => { setCurrentStep(AppStep.VIEW_RESULTS); setErrorMessage(null); }}
                className="text-blue-600 font-bold underline p-4 block mx-auto"
              >
                ดูผลคะแนนเดิม ({activeSubject.results.length} แผ่น)
              </button>
            )}
          </section>
        )}

        {currentStep === AppStep.VIEW_RESULTS && activeSubject && (
          <section className="space-y-6 animate-fadeIn pb-24">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold">ผลคะแนน: {activeSubject.name}</h2>
                <p className="text-sm text-gray-500">ทั้งหมด {activeSubject.results.length} รายการ | เรียงตามเลขที่</p>
              </div>
              <div className="flex gap-2 w-full md:w-auto">
                <button 
                  onClick={exportToCSV}
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-md active:scale-95 transition"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ส่งออก CSV
                </button>
                <button 
                  onClick={() => { setCurrentStep(AppStep.SCAN_STUDENTS); setErrorMessage(null); }}
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-md active:scale-95 transition"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ตรวจเพิ่ม
                </button>
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">เลขที่</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">ชื่อ-นามสกุล</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">คะแนน</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">สถานะ/ข้อผิดพลาด</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {activeSubject.results.map((r, idx) => (
                      <tr key={r.id} className="hover:bg-blue-50/30 transition group">
                        <td className="px-6 py-4 whitespace-nowrap font-bold text-gray-700">
                           <input 
                              value={r.studentNumber} 
                              onChange={(e) => {
                                const newResults = [...activeSubject.results];
                                newResults[idx].studentNumber = e.target.value;
                                const updated = { ...activeSubject, results: newResults };
                                setActiveSubject(updated);
                                setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
                              }}
                              className="w-16 bg-transparent border-b border-gray-100 focus:border-blue-500 outline-none p-1"
                           />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                           <input 
                              value={r.studentName} 
                              onChange={(e) => {
                                const newResults = [...activeSubject.results];
                                newResults[idx].studentName = e.target.value;
                                const updated = { ...activeSubject, results: newResults };
                                setActiveSubject(updated);
                                setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
                              }}
                              className="w-full max-w-xs bg-transparent border-b border-gray-100 focus:border-blue-500 outline-none p-1"
                           />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <span className="text-xl font-bold text-blue-600">{r.totalScore}</span>
                          <span className="text-gray-400 text-sm ml-1">/{activeSubject.totalQuestions}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {r.hasError ? (
                            <span className="flex items-center gap-1 text-red-500 text-xs font-medium bg-red-50 px-2 py-1 rounded-full">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth="2"/></svg>
                              ตรวจไม่ชัดเจนบางข้อ
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-green-600 text-xs font-medium bg-green-50 px-2 py-1 rounded-full w-fit">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeWidth="2"/></svg>
                              ปกติ
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button 
                            onClick={() => {
                              const newResults = activeSubject.results.filter(res => res.id !== r.id);
                              const updated = { ...activeSubject, results: newResults };
                              setActiveSubject(updated);
                              setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
                            }}
                            className="text-gray-300 hover:text-red-500 transition p-2"
                          >
                             ลบ
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* FOOTER INFO */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-gray-100 p-3 text-center text-xs text-gray-400 flex items-center justify-center gap-4 z-40">
        <span>© 2024 ระบบตอดสวบ</span>
        <div className="flex items-center gap-1 text-blue-500 font-medium">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
          AI Powered Processing
        </div>
      </footer>
    </div>
  );
};

export default App;
