// Uses global window._auth and window._db which are set in index.html
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  ref, get, set, update, push, onValue, child
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

const auth = window._auth;
const db = window._db;

// --------- Helpers ----------
const $ = (id) => document.getElementById(id);
const show = (id)=> $(id).classList.remove("hidden");
const hide = (id)=> $(id).classList.add("hidden");
const uid = ()=> auth.currentUser?.uid;
const isAdmin = ()=> auth.currentUser?.email === "babarbhutta395@gmail.com";

function genRefCode(len=6){
  const c="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; let s="";
  for(let i=0;i<len;i++) s+=c[Math.floor(Math.random()*c.length)];
  return s;
}

// --------- Navbar actions ----------
$("#btnLogin").onclick = ()=> openPage("auth");
$("#btnSignup").onclick = ()=> openPage("auth");
$("#btnDashboard").onclick = ()=> openPage("dashboard");
$("#btnAdmin").onclick = ()=> openPage("admin");
$("#btnLogout").onclick = async ()=> { await signOut(auth); openPage("home"); };

function openPage(page){
  ["home","auth","dashboard","admin"].forEach(p=> hide(`page-${p}`));
  show(`page-${page}`);
}

// --------- Lang tabs ----------
document.querySelectorAll(".tab").forEach(btn=>{
  btn.onclick = ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const lang = btn.dataset.lang;
    document.querySelectorAll(".lang").forEach(el=>el.classList.remove("active"));
    $(`lang-${lang}`).classList.add("active");
  }
});

// --------- Auth Handlers ----------
$("#doSignup").onclick = async ()=>{
  const email = $("#signupEmail").value.trim();
  const pass = $("#signupPass").value.trim();
  const refCode = $("#signupRef").value.trim().toUpperCase() || null;
  if(!email || !pass) return alert("Enter email & password");
  const { user } = await createUserWithEmailAndPassword(auth, email, pass);
  // save user profile
  const myRef = genRefCode();
  await set(ref(db, `users/${user.uid}`), { email, coins:0, referralCode: myRef, referredBy: refCode, tasks:{}, notifications:{} });

  // credit referrer +20
  if(refCode){
    const all = await get(ref(db, "users"));
    if(all.exists()){
      let rid = null;
      all.forEach(snap=>{ if(snap.val().referralCode === refCode) rid = snap.key; });
      if(rid){
        const refUserRef = ref(db, `users/${rid}`);
        const snap = await get(refUserRef);
        const cur = snap.val()?.coins || 0;
        await update(refUserRef, { coins: cur + 20 });
      }
    }
  }
  alert("Signup successful!");
  openPage("dashboard");
};

$("#doLogin").onclick = async ()=>{
  const email = $("#loginEmail").value.trim();
  const pass = $("#loginPass").value.trim();
  if(!email || !pass) return alert("Enter email & password");
  await signInWithEmailAndPassword(auth, email, pass);
  openPage("dashboard");
};

// --------- Auth state -> UI ----------
onAuthStateChanged(auth, async (user)=>{
  if(!user){
    // nav
    show("btnLogin"); show("btnSignup");
    hide("btnDashboard"); hide("btnAdmin"); hide("btnLogout");
    openPage("home");
    return;
  }
  hide("btnLogin"); hide("btnSignup");
  show("btnDashboard"); show("btnLogout");
  if(isAdmin()) show("btnAdmin"); else hide("btnAdmin");
  await loadDashboard();
  openPage("dashboard");
});

// --------- Dashboard ----------
async function loadDashboard(){
  const uref = ref(db, `users/${uid()}`);
  onValue(uref, (snap)=>{
    const u = snap.val()||{};
    $("#userCoins").textContent = u.coins || 0;
    $("#myRef").textContent = u.referralCode || "-";
  });

  // notifications
  onValue(ref(db, `users/${uid()}/notifications`), (snap)=>{
    const list = $("#notifList"); list.innerHTML = "";
    const v = snap.val() || {};
    Object.entries(v).reverse().forEach(([id,n])=>{
      const li = document.createElement("li");
      li.innerHTML = `<span>${n.msg}</span> <small>${new Date(n.at).toLocaleString()}</small>`;
      list.appendChild(li);
    });
  });

  // tasks list
  onValue(ref(db, "tasks"), (snap)=>{
    const tasks = snap.val() || {};
    const list = $("#taskList"); list.innerHTML = "";
    Object.entries(tasks).forEach(([tid, t])=>{
      if(!t.active) return;
      if(t.completedBy?.[uid()]) return; // already done by me
      if((t.completedCount||0) >= (t.quantity||0)) return;
      const li = document.createElement("li");
      li.innerHTML = `
        <div>
          <b>${t.title}</b>
          <div class="muted">Reward: 1 coin • ${t.completedCount||0}/${t.quantity} done</div>
        </div>
        <button class="btn" data-tid="${tid}">Complete</button>
      `;
      list.appendChild(li);
    });
    // attach handlers
    list.querySelectorAll("button[data-tid]").forEach(btn=>{
      btn.onclick = ()=> completeTask(btn.dataset.tid);
    });
  });
}

// Add task
$("#addTask").onclick = async ()=>{
  const title = $("#taskTitle").value.trim();
  const qty = parseInt($("#taskQty").value||"0",10);
  if(!title || qty<1) return alert("Enter title & quantity");
  const uref = ref(db, `users/${uid()}`);
  const usnap = await get(uref);
  const coins = usnap.val()?.coins || 0;
  const cost = qty*2;
  if(coins < cost) return alert(`Not enough coins. Need ${cost}, you have ${coins}`);

  const tRef = push(ref(db, "tasks"));
  await set(tRef, {
    title, quantity: qty, completedCount: 0, coinsReward: 1,
    owner: uid(), active: true, createdAt: Date.now(), completedBy: {}
  });
  await update(uref, { coins: coins - cost });
  $("#taskTitle").value = ""; $("#taskQty").value = 10;
  alert("Task created!");
};

// Complete task (manual check placeholder)
async function completeTask(tid){
  const tRef = ref(db, `tasks/${tid}`);
  const tSnap = await get(tRef);
  if(!tSnap.exists()) return;
  const t = tSnap.val();

  // prevent double-credit
  if(t.completedBy?.[uid()]) return alert("Already completed.");
  // credit user +1
  const uref = ref(db, `users/${uid()}`);
  const usnap = await get(uref);
  const myCoins = usnap.val()?.coins || 0;
  await update(uref, { coins: myCoins + 1 });

  // mark task done by me
  const newCount = (t.completedCount||0) + 1;
  await update(tRef, {
    completedCount: newCount,
    [`completedBy/${uid()}`]: true
  });

  // if quantity reached -> deactivate + notify owner
  if(newCount >= (t.quantity||0)){
    await update(tRef, { active:false });
    const nRef = push(ref(db, `users/${t.owner}/notifications`));
    await set(nRef, { msg: `Your task "${t.title}" completed (${newCount}/${t.quantity}).`, at: Date.now() });
  }

  alert("Task completed! +1 coin");
}

// Payment upload
$("#sendPay").onclick = async ()=>{
  const amount = parseFloat($("#payAmount").value||"0");
  const file = $("#payFile").files[0];
  if(!amount || !file) return alert("Enter amount and choose screenshot.");
  const reader = new FileReader();
  reader.onloadend = async ()=>{
    const base64 = reader.result;
    const rRef = push(ref(db, `users/${uid()}/paymentRequests`));
    await set(rRef, { amount, proof: base64, status:"pending", at: Date.now() });
    alert("Payment request submitted. Admin will approve within 6 hours.");
    $("#payAmount").value=""; $("#payFile").value="";
  };
  reader.readAsDataURL(file);
};

// --------- Admin Panel ----------
function loadAdmin(){
  const wrap = $("#adminPayWrap"); wrap.innerHTML = "";
  onValue(ref(db, "users"), (snap)=>{
    wrap.innerHTML = "";
    const users = snap.val() || {};
    Object.entries(users).forEach(([u, obj])=>{
      const reqs = obj.paymentRequests || {};
      Object.entries(reqs).forEach(([rid, r])=>{
        if(r.status !== "pending") return;
        const div = document.createElement("div");
        div.className = "card";
        div.innerHTML = `
          <div style="display:flex;gap:12px;align-items:flex-start">
            <img src="${r.proof}" style="width:140px;border-radius:12px" />
            <div>
              <div><b>${obj.email}</b></div>
              <div>Amount: <b>${r.amount}</b> (coins to add)</div>
              <div class="muted">Submitted: ${new Date(r.at).toLocaleString()}</div>
              <div style="margin-top:8px;display:flex;gap:8px">
                <button class="btn" data-approve="${u}::${rid}::${r.amount}">Approve</button>
                <button class="btn danger" data-reject="${u}::${rid}">Reject</button>
              </div>
            </div>
          </div>
        `;
        wrap.appendChild(div);
      });
    });
    // handlers
    wrap.querySelectorAll("button[data-approve]").forEach(b=>{
      b.onclick = async ()=>{
        const [userId, reqId, amount] = b.dataset.approve.split("::");
        const uref = ref(db, `users/${userId}`);
        const usnap = await get(uref);
        const cur = usnap.val()?.coins || 0;
        await update(uref, { coins: cur + Number(amount) });
        await update(ref(db, `users/${userId}/paymentRequests/${reqId}`), { status:"approved" });
        alert("Approved & coins added.");
      };
    });
    wrap.querySelectorAll("button[data-reject]").forEach(b=>{
      b.onclick = async ()=>{
        const [userId, reqId] = b.dataset.reject.split("::");
        await update(ref(db, `users/${userId}/paymentRequests/${reqId}`), { status:"rejected" });
        alert("Rejected.");
      };
    });
  });
}

// show/hide pages by role
$("#btnAdmin").addEventListener("click", ()=>{
  if(!isAdmin()) return alert("Admin only");
  loadAdmin();
});

// initial route: home
openPage("home");
