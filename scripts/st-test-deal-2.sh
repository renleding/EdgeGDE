#!/bin/bash
# Create Test Deal 2 in Salestrekker via AppleScript JS injection
# Uses the active Chrome window — no profile kill, no session loss.

DEAL_TITLE="Test 2 — Purple Circle Onboarding"
BASE="https://pc.v2.salestrekker.com"

echo "=== Creating Test Deal 2 ==="
echo "Target: $DEAL_TITLE"

# Navigate to dashboard
osascript -e 'tell application "Google Chrome" to set URL of active tab of window 1 to "https://pc.v2.salestrekker.com/dashboard"'
sleep 4

# Click Add New button
osascript -e '
tell application "Google Chrome"
    execute active tab of window 1 javascript "
document.querySelectorAll(\"button,a,span\").forEach(function(el){
    if(el.textContent.trim()===\"Add New\"&&el.offsetParent!==null){
        el.click();
    }
});
"
end tell'
sleep 3

# Set deal title via native setter
osascript -e '
tell application "Google Chrome"
    execute active tab of window 1 javascript "
var inputs=document.querySelectorAll(\"input\");
for(var i=0;i<inputs.length;i++){
    var inp=inputs[i];
    if(inp.offsetParent!==null&&inp.type!==\"hidden\"){
        var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,\"value\").set;
        s.call(inp,\"Test 2 — Purple Circle Onboarding\");
        inp.dispatchEvent(new Event(\"input\",{bubbles:true}));
        inp.dispatchEvent(new Event(\"change\",{bubbles:true}));
        break;
    }
}
"
end tell'
echo "  ✅ Title set"

# Set finance due (+14 days) and settlement (+90 days)
osascript -e '
tell application "Google Chrome"
    execute active tab of window 1 javascript "
var d=new Date();
d.setDate(d.getDate()+14);
var fd=(\"0\"+d.getDate()).slice(-2)+\"/\"+(\"0\"+(d.getMonth()+1)).slice(-2)+\"/\"+d.getFullYear();
d.setDate(d.getDate()+76);
var es=(\"0\"+d.getDate()).slice(-2)+\"/\"+(\"0\"+(d.getMonth()+1)).slice(-2)+\"/\"+d.getFullYear();
var inputs=document.querySelectorAll(\"input\");
var fi=0,si=0;
for(var i=0;i<inputs.length;i++){
    var inp=inputs[i];
    if(inp.offsetParent!==null&&inp.type!==\"hidden\"&&inp.placeholder){
        var p=inp.placeholder.toLowerCase();
        if(p.indexOf(\"finance\")>=0||p.indexOf(\"due\")>=0){
            var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,\"value\").set;
            s.call(inp,fd);inp.dispatchEvent(new Event(\"input\",{bubbles:true}));inp.dispatchEvent(new Event(\"change\",{bubbles:true}));
            fi=1;
        }
        if(p.indexOf(\"settle\")>=0){
            var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,\"value\").set;
            s.call(inp,es);inp.dispatchEvent(new Event(\"input\",{bubbles:true}));inp.dispatchEvent(new Event(\"change\",{bubbles:true}));
            si=1;
        }
    }
}
"
end tell'
echo "  ✅ Dates set"

# Save
sleep 2
osascript -e '
tell application "Google Chrome"
    execute active tab of window 1 javascript "
document.querySelectorAll(\"button\").forEach(function(b){
    if(b.textContent.trim()===\"Save\"&&b.offsetParent!==null){
        b.click();
    }
});
"
end tell'
echo "  ✅ Saved"
sleep 4

# Now navigate to add contacts
osascript -e '
tell application "Google Chrome"
    execute active tab of window 1 javascript "
document.querySelectorAll(\"button,a,span\").forEach(function(el){
    var t=el.textContent.trim().toLowerCase();
    if((t.indexOf(\"add\")>=0&&(t.indexOf(\"contact\")>=0||t.indexOf(\"person\")>=0||t.indexOf(\"applicant\")>=0))&&el.offsetParent!==null){
        el.click();
    }
});
"
end tell'
sleep 3
echo "  ✅ Add contact opened"

# Fill Sam Smith fields
osascript -e '
tell application "Google Chrome"
    execute active tab of window 1 javascript "
var fields={};
fields[\"First name\"]=\"Sam\";
fields[\"Last name\"]=\"Smith\";
fields[\"Email\"]=\"sam.smith@example.com\";
var labels=document.querySelectorAll(\"label,span,div,strong\");
for(var l=0;l<labels.length;l++){
    var lbl=labels[l];
    var txt=lbl.textContent.trim();
    if(fields[txt]!==undefined&&lbl.offsetParent!==null){
        var c=lbl.closest(\"div\")||lbl.parentElement;
        var inp=c.querySelector(\"input\");
        if(inp){
            var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,\"value\").set;
            s.call(inp,fields[txt]);
            inp.dispatchEvent(new Event(\"input\",{bubbles:true}));
            inp.dispatchEvent(new Event(\"change\",{bubbles:true}));
        }
    }
}
"
end tell'
echo "  ✅ Sam Smith fields filled"

# Save
sleep 2
osascript -e '
tell application "Google Chrome"
    execute active tab of window 1 javascript "
document.querySelectorAll(\"button\").forEach(function(b){
    if((b.textContent.trim()===\"Save\"||b.textContent.trim()===\"Done\")&&b.offsetParent!==null){
        b.click();
    }
});
"
end tell'
echo "  ✅ Deal created with Sam Smith"
sleep 3

echo ""
echo "=== Test Deal 2 creation complete ==="
echo "Deal: $DEAL_TITLE"
