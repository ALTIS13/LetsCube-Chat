package com.kub.messenger;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.cert.Certificate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import javax.net.ssl.HttpsURLConnection;

/** Actual parser/transport; HTTPS connections and Android JSON decoding are doubles, never network. */
public final class MessagePreviewCapabilityProbe {
    static final String USER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", SESSION="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    static final String DEVICE="cccccccc-cccc-4ccc-8ccc-ccccccccccc1", OTHER="dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
    static final String ACCESS="fictional-access", KEY="fictional-public-key";
    static void check(boolean value,String code){if(!value)throw new AssertionError(code);}
    static Method method(Class<?> type,String name,String missing,Class<?>... parameters){
        try{return type.getDeclaredMethod(name,parameters);}
        catch(NoSuchMethodException failure){throw new AssertionError(missing);}
    }
    static Object invoke(Method method,Object target,Object... args)throws Exception{
        try{return method.invoke(target,args);}
        catch(InvocationTargetException failure){
            if(failure.getCause() instanceof Exception)throw (Exception)failure.getCause();
            throw (Error)failure.getCause();
        }
    }
    static String parse(Object response,String user,String session,String device)throws Exception{
        return (String)invoke(method(MessagePreviewResponseParser.class,"capability","CAPABILITY_PARSER_ENTRY_REQUIRED",
            Object.class,String.class,String.class,String.class),null,response,user,session,device);
    }
    static String parse(Object response)throws Exception{return parse(response,USER,SESSION,DEVICE);}
    static Map<String,Object> row(){
        Map<String,Object> row=new HashMap<>();row.put("preview_v",1);row.put("recipient_id",USER);
        row.put("session_id",SESSION);row.put("device_id",DEVICE);row.put("preview_level","message");return row;
    }
    static void parser(String scenario)throws Exception{
        Map<String,Object> row=row();Object response=List.of(row);
        if(scenario.equals("levels")){
            for(String level:new String[]{"none","sender","message"}){
                row.put("preview_level",level);check(level.equals(parse(List.of(row))),"EXACT_CAPABILITY_LEVEL");
            }
            for(Number version:new Number[]{1,1L,1d}){row.put("preview_v",version);check("message".equals(parse(List.of(row))),"NUMERIC_VERSION_ONE");}
            return;
        }
        if(scenario.equals("missing")){
            for(String key:new String[]{"preview_v","recipient_id","session_id","device_id","preview_level"}){
                Map<String,Object> missing=row();missing.remove(key);check(parse(List.of(missing))==null,"CAPABILITY_REFUSED");
                missing.put("unknown",true);check(parse(List.of(missing))==null,"CAPABILITY_REFUSED");
            }return;
        }
        if(scenario.equals("versions")){
            for(Object version:new Object[]{null,"1",true,0,2,-1,1.25,Double.NaN,Double.POSITIVE_INFINITY,Long.MAX_VALUE,List.of(1),Map.of("v",1)}){
                row.put("preview_v",version);check(parse(List.of(row))==null,"CAPABILITY_REFUSED");
            }return;
        }
        if(scenario.equals("level-types")){
            for(Object level:new Object[]{null,"","rich","MESSAGE","message ",1,true,List.of("message"),Map.of("level","message")}){
                row.put("preview_level",level);check(parse(List.of(row))==null,"CAPABILITY_REFUSED");
            }return;
        }
        if(scenario.startsWith("tuple-")||scenario.startsWith("type-")){
            String key=scenario.substring(scenario.indexOf('-')+1);row.put(key,scenario.startsWith("tuple-")?OTHER:List.of(row.get(key)));
        }else if(scenario.startsWith("expected-")){
            String field=scenario.substring(9);
            for(String invalid:new String[]{"invalid",USER.toUpperCase(java.util.Locale.ROOT),null}){
                String user=field.equals("recipient")?invalid:USER,session=field.equals("session")?invalid:SESSION,device=field.equals("device")?invalid:DEVICE;
                row.put(field.equals("recipient")?"recipient_id":field+"_id",invalid);
                check(parse(List.of(row),user,session,device)==null,"EXPECTED_UUID_REQUIRED");
            }return;
        }else if(scenario.equals("unknown"))row.put("unknown",true);
        else if(scenario.equals("root-map"))response=row;
        else if(scenario.equals("empty"))response=List.of();
        else if(scenario.equals("multiple"))response=List.of(row,row);
        else if(scenario.equals("row-null")){List<Object> rows=new ArrayList<>();rows.add(null);response=rows;}
        else if(scenario.equals("row-list"))response=List.of(List.of(row));
        else if(scenario.equals("root-null"))response=null;
        else if(scenario.equals("root-scalar"))response="message";
        else throw new AssertionError("UNKNOWN_PARSER_CASE");
        check(parse(response)==null,"CAPABILITY_REFUSED");
    }
    static final class Connection extends HttpsURLConnection {
        byte[] body;
        final ByteArrayOutputStream sent=new ByteArrayOutputStream();
        boolean disconnected,inputClosed,outputClosed;
        int status=200,inputCalls,streamingLength;
        long declared=-1;
        String type="application/json; charset=utf-8";
        Runnable afterWrite=()->{},afterStatus=()->{},onRead=()->{};
        Connection(URL url,byte[] body){super(url);this.body=body;}
        public String getCipherSuite(){return "fictional";}
        public Certificate[] getLocalCertificates(){return null;}
        public Certificate[] getServerCertificates(){return null;}
        public void disconnect(){disconnected=true;}
        public boolean usingProxy(){return false;}
        public void connect(){}
        public int getResponseCode(){afterStatus.run();return status;}
        public String getContentType(){return type;}
        public long getContentLengthLong(){return declared;}
        public void setFixedLengthStreamingMode(int length){super.setFixedLengthStreamingMode(length);streamingLength=length;}
        public OutputStream getOutputStream(){return new OutputStream(){
            public void write(int value){sent.write(value);}
            public void write(byte[] b,int off,int len){sent.write(b,off,len);afterWrite.run();}
            public void close(){outputClosed=true;}
        };}
        public InputStream getInputStream(){inputCalls++;return new ByteArrayInputStream(body){
            public synchronized int read(byte[] b,int off,int len){onRead.run();return super.read(b,off,len);}
            public void close(){inputClosed=true;}
        };}
    }
    static final class Fixture {
        long now=100;
        String body="[{\"preview_v\":1,\"recipient_id\":\""+USER+"\",\"session_id\":\""+SESSION
            +"\",\"device_id\":\""+DEVICE+"\",\"preview_level\":\"message\"}]";
        final List<Connection> opened=new ArrayList<>();
        java.util.function.Consumer<Connection> configure=c->{};
        final MessagePreviewHttpTransport transport=new MessagePreviewHttpTransport(()->now,url->{
            Connection c=new Connection(url,body.getBytes(StandardCharsets.UTF_8));opened.add(c);configure.accept(c);return c;
        });
        Fixture(){JSONTokener.fixture(body,new JSONArray(new JSONObject(row())));}
        void response(String wire,Object decoded){body=wire;JSONTokener.fixture(wire,decoded);}
        Object request(String access,String key,String device,long deadline)throws Exception{
            return invoke(method(MessagePreviewHttpTransport.class,"capability","CAPABILITY_REQUEST_ENTRY_REQUIRED",
                String.class,String.class,String.class,long.class),transport,access,key,device,deadline);
        }
        Object request()throws Exception{return request(ACCESS,KEY,DEVICE,8100);}
        Connection last(){return opened.get(opened.size()-1);}
    }
    interface Action {void run()throws Exception;}
    static void refused(Action action)throws Exception{
        boolean refused=false;try{action.run();}catch(IOException failure){refused=true;check("PREVIEW_REFUSED".equals(failure.getMessage()),"FIXED_TRANSPORT_REFUSAL");}
        check(refused,"TRANSPORT_REFUSAL_REQUIRED");
    }
    static void transport(String scenario)throws Exception{
        Fixture f=new Fixture();
        if(scenario.startsWith("invalid-")){
            String access=ACCESS,key=KEY,device=DEVICE;
            switch(scenario.substring(8)){
                case "device":device="invalid";break;
                case "device-null":device=null;break;
                case "device-injection":device=DEVICE+"\"}";break;
                case "device-uppercase":device=DEVICE.toUpperCase(java.util.Locale.ROOT);break;
                case "access":access="fictional\r\ninjection";break;
                case "access-bound":access="a".repeat(8193);break;
                case "key":key="";break;
                case "key-bound":key="k".repeat(4097);break;
                default:throw new AssertionError("UNKNOWN_INVALID_CASE");
            }
            final String a=access,k=key,d=device;refused(()->f.request(a,k,d,8100));check(f.opened.isEmpty(),"INVALID_ZERO_IO");return;
        }
        if(scenario.equals("expired")){refused(()->f.request(ACCESS,KEY,DEVICE,100));check(f.opened.isEmpty(),"EXPIRED_ZERO_IO");return;}
        if(scenario.equals("empty"))f.response("[]",new JSONArray());
        if(scenario.equals("multiple"))f.response("[{},{}]",new JSONArray(new JSONObject(row()),new JSONObject(row())));
        if(scenario.equals("root-map"))f.response("{}",new JSONObject(row()));
        if(scenario.equals("row-scalar"))f.response("[1]",new JSONArray(1));
        if(scenario.equals("unknown")){Map<String,Object> row=row();row.put("unknown",true);f.response("[{\"unknown\":true}]",new JSONArray(new JSONObject(row)));}
        if(scenario.startsWith("status-"))f.configure=c->c.status=Integer.parseInt(scenario.substring(7));
        if(scenario.equals("wrong-type"))f.configure=c->c.type="text/html";
        if(scenario.equals("declared-large"))f.configure=c->c.declared=32769;
        if(scenario.equals("stream-large")){String wire=" ".repeat(32769);f.response(wire,new JSONArray(new JSONObject(row())));}
        if(scenario.equals("deadline-write"))f.configure=c->c.afterWrite=()->f.now=8100;
        if(scenario.equals("deadline-status"))f.configure=c->c.afterStatus=()->f.now=8100;
        if(scenario.equals("deadline-read"))f.configure=c->c.onRead=()->f.now=8100;
        if(scenario.equals("cancel"))f.configure=c->c.onRead=()->f.transport.cancel();
        if(scenario.startsWith("status-")||scenario.startsWith("deadline-")||scenario.equals("wrong-type")
            ||scenario.equals("declared-large")||scenario.equals("stream-large")||scenario.equals("cancel"))refused(f::request);
        else{
            Object response=f.request(ACCESS,KEY,DEVICE,scenario.equals("short-deadline")?101:8100);
            if(List.of("empty","multiple","root-map","row-scalar").contains(scenario))check(response==null,"TRANSPORT_EXACT_ONE_ROW");
            else if(scenario.equals("unknown"))check(response instanceof List&&((Map<?,?>)((List<?>)response).get(0)).containsKey("unknown")
                &&parse(response)==null,"UNKNOWN_FIELD_NOT_PROJECTED_AWAY");
            else{
                check(response instanceof List&&List.of(row()).equals(response)&&"message".equals(parse(response)),"TRANSPORT_PARSER_CURRENT_TUPLE");
                Connection c=f.last();
                check(c.getURL().toString().equals("https://core.letscube.ru/rest/v1/rpc/native_message_preview_capability")
                    &&c.getRequestMethod().equals("POST"),"CAPABILITY_FIXED_RPC");
                check(c.sent.toString("UTF-8").equals("{\"p_device_id\":\"cccccccc-cccc-4ccc-8ccc-ccccccccccc1\"}")
                    &&c.streamingLength==54,"CAPABILITY_EXACT_BODY");
                check("Bearer fictional-access".equals(c.getRequestProperty("Authorization"))&&"fictional-public-key".equals(c.getRequestProperty("apikey"))
                    &&"application/json".equals(c.getRequestProperty("Accept"))&&"application/json".equals(c.getRequestProperty("Content-Type"))
                    &&"identity".equals(c.getRequestProperty("Accept-Encoding"))&&"close".equals(c.getRequestProperty("Connection")),"CAPABILITY_EXACT_HEADERS");
                check(!c.getInstanceFollowRedirects()&&!c.getUseCaches(),"CAPABILITY_NO_REDIRECT_CACHE");
                check(c.getConnectTimeout()==(scenario.equals("short-deadline")?1:2000)&&c.getReadTimeout()==(scenario.equals("short-deadline")?1:2000),"CAPABILITY_BOUNDED_TIMEOUT");
            }
        }
        check(f.opened.size()==1&&f.last().disconnected&&f.last().outputClosed,"ONE_REQUEST_NO_RETRY_CLOSED");
        if(scenario.startsWith("status-")||scenario.equals("wrong-type")||scenario.equals("declared-large"))check(f.last().inputCalls==0,"NO_ERROR_BODY_READ");
        else if(!scenario.equals("deadline-write")&&!scenario.equals("deadline-status"))check(f.last().inputClosed,"CAPABILITY_INPUT_CLOSED");
    }
    public static void main(String[] args){
        try{
            if(args[0].startsWith("parser-"))parser(args[0].substring(7));else transport(args[0].substring(10));
            System.out.println("PASS "+args[0]);
        }catch(Throwable failure){String code=failure instanceof AssertionError?failure.getMessage():null;
            System.err.println("FAIL "+(code!=null&&code.matches("[A-Z0-9_]+")?code:"UNEXPECTED_FAILURE"));System.exit(1);}
    }
}
