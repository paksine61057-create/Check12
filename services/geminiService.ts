
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

const getSafeApiKey = (): string => {
  let key = "";
  try {
    const envKey = (typeof process !== 'undefined' && process.env?.API_KEY) ? process.env.API_KEY : "";
    const windowKey = (window as any).API_KEY || "";
    const manualKey = localStorage.getItem('manual_api_key') || "";
    key = envKey || windowKey || manualKey || "";
  } catch (e) {
    key = localStorage.getItem('manual_api_key') || (window as any).API_KEY || "";
  }
  return key.toString().trim().replace(/^['"]|['"]$/g, '');
};

const cleanJsonResponse = (text: string): string => {
  if (!text) return "";
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) return text.substring(start, end + 1);
  return text.replace(/```json/g, "").replace(/```/g, "").trim();
};

export const analyzeAnswerSheet = async (
  base64Image: string,
  totalQuestions: number,
  isKey: boolean = false
): Promise<{ 
  answers: Choice[], 
  studentId?: string, 
  studentName?: string,
  error?: string,
  isAuthError?: boolean
}> => {
  try {
    const apiKey = getSafeApiKey();
    if (!apiKey || apiKey.length < 5) {
      return { answers: [], error: "กรุณาเชื่อมต่อ API Key ก่อนใช้งาน", isAuthError: true };
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // ปรับปรุง Instruction ให้ AI เข้าใจลักษณะ "รอยฝน" มากขึ้น
    const systemInstruction = isKey 
      ? `คุณคือผู้เชี่ยวชาญด้าน OMR หน้าที่ของคุณคือวิเคราะห์ "กระดาษเฉลย" (Answer Key) ข้อ 1-${totalQuestions} มองหารอยฝนหรือสัญลักษณ์ที่ระบุคำตอบที่ถูกต้องอย่างละเอียด คืนค่าเป็น JSON เท่านั้น`
      : `คุณคือระบบตรวจข้อสอบอัตโนมัติ อ่านรอยฝนคำตอบนักเรียนข้อ 1-${totalQuestions} พร้อมอ่านเลขที่และชื่อ คืนค่าเป็น JSON เท่านั้น`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: isKey ? `Extract the correct answers for questions 1 to ${totalQuestions}. Look for filled circles.` : `Identify student info and answers 1 to ${totalQuestions}.` }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0,
        responseMimeType: "application/json",
        // สำหรับใบเฉลย (isKey) ให้ Thinking Budget เล็กน้อยเพื่อความแม่นยำ 
        // สำหรับใบนักเรียนให้เป็น 0 เพื่อความเร็วในการตรวจจำนวนมาก
        thinkingConfig: { thinkingBudget: isKey ? 512 : 0 }, 
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.INTEGER },
                  marked: { type: Type.STRING, nullable: true }
                },
                required: ["id", "marked"]
              }
            },
            studentNumber: { type: Type.STRING },
            studentName: { type: Type.STRING }
          },
          required: ["questions"]
        }
      }
    });

    if (!response.text) throw new Error("AI Timeout");
    
    const data = JSON.parse(cleanJsonResponse(response.text));
    const answers: Choice[] = new Array(totalQuestions).fill(null);
    
    if (data.questions && Array.isArray(data.questions)) {
      data.questions.forEach((q: any) => {
        const idx = q.id - 1;
        if (idx >= 0 && idx < totalQuestions) {
          const val = q.marked;
          // แปลงค่าจาก AI ให้เป็นรูปแบบที่ระบบรองรับ (ก ข ค ง)
          if (['ก', 'ข', 'ค', 'ง', 'multiple'].includes(val)) {
            answers[idx] = val as Choice;
          } else {
            answers[idx] = null;
          }
        }
      });
    }

    return {
      answers,
      studentId: data.studentNumber || "",
      studentName: data.studentName || ""
    };
  } catch (err: any) {
    console.error("OMR Service Error:", err);
    return { answers: [], error: "AI ไม่สามารถวิเคราะห์ภาพได้ กรุณาตรวจสอบความชัดเจนของภาพ", isAuthError: err.message?.includes("401") };
  }
};
