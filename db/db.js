const mongoose = require('mongoose')
function connect(){
    mongoose.connect(process.env.MONGODB_URI)
    .then(()=>{
        console.log("DATABASE CONNECTED")
    })
    .catch((error)=>{
        console.error("ERROR IN CONNECTING DATABASE",error)
        process.exit(1)
    })
}
module.exports = connect